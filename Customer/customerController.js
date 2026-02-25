import Customer from "./Customer.js";
import { Mailer } from "../nodemailer/events/mailer.js"; // ✅ adjust relative path if needed


const normalizeIncomingCustomer = (body = {}) => {
  const firebaseUID = body.firebaseUID ? String(body.firebaseUID).trim() : null;
  const email = body.email ? String(body.email).trim().toLowerCase() : "";
  const phone = body.phone ? String(body.phone).trim() : "";
  const name = body.name ? String(body.name).trim() : "";
  const profileImage = body.profileImage ? String(body.profileImage).trim() : "";

  return {
    firebaseUID: firebaseUID || null,
    email,
    phone,
    name,
    profileImage,
    referredBy: body.referredBy || null,
    referralCode: body.referralCode || null,
  };
};

// Only set if incoming has value; for existing fields choose policy
const buildSafeUpdate = ({
  email,
  phone,
  name,
  profileImage,
  payoutDetails,
}) => {
  const $set = {};

  // ✅ Basic fields (update only if provided)
  if (email) $set.email = email;
  if (phone) $set.phone = phone;
  if (name) $set.name = name;
  if (profileImage) $set.profileImage = profileImage;

  // ✅ Banking / UPI (optional — update only if provided)
  const bank = payoutDetails?.bank || {};
  const upi = payoutDetails?.upi || {};

  if (bank.accountHolderName)
    $set["payoutDetails.bank.accountHolderName"] =
      bank.accountHolderName.trim();

  if (bank.accountNumber)
    $set["payoutDetails.bank.accountNumber"] =
      bank.accountNumber.trim();

  if (bank.ifscCode)
    $set["payoutDetails.bank.ifscCode"] =
      bank.ifscCode.trim().toUpperCase();

  if (upi.upiId)
    $set["payoutDetails.upi.upiId"] =
      upi.upiId.trim().toLowerCase();

  // ✅ If any payout field updated → update payoutDetails.updatedAt
  if (
    bank.accountHolderName ||
    bank.accountNumber ||
    bank.ifscCode ||
    upi.upiId
  ) {
    $set["payoutDetails.updatedAt"] = new Date();
  }

  // ✅ Always update document updatedAt
  $set.updatedAt = new Date();

  return $set;
};

const getOrCreateCustomerAtomic = async ({
  firebaseUID,
  email,
  phone,
  name,
  profileImage,
  referredBy,
  referralCode,
}) => {
  const finalReferralCode =
    referralCode || Math.random().toString(36).substring(2, 10).toUpperCase();

  // Prefer firebaseUID if present
  const filter = firebaseUID
    ? { firebaseUID }
    : {
        $or: [
          ...(email ? [{ email }] : []),
          ...(phone ? [{ phone }] : []),
        ],
      };

  const update = {
    $set: buildSafeUpdate({ email, phone, name, profileImage }),
    $setOnInsert: {
      firebaseUID: firebaseUID || null,
      email: email || "",
      name: name || "",
      phone: phone || "",
      profileImage: profileImage || "",
      referralCode: finalReferralCode,
      referredBy: referredBy || null,
      cart: {
        activeCartId: null,
        activeCartType: "cart",
        cartCount: 0,
        abandonedCartCount: 0,
        lastCartActivityAt: null,
        lastAbandonedCartId: null,
      },
      joinedAt: new Date(),
      createdAt: new Date(),
      isActive: true,
    },
  };

  // Important: rawResult gives lastErrorObject.updatedExisting
  const result = await Customer.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
    rawResult: true,
  });

  const customer = result.value;
  const wasCreated = result.lastErrorObject?.updatedExisting === false;

  return { customer, wasCreated };
};


/**
 * ---------------------------------------------------------
 * ✅ Create or update customer (OAuth login + Guest Checkout)
 * @route POST /api/customers
 * @access Public
 * ---------------------------------------------------------
 */
export const createCustomer = async (req, res) => {
  try {
    const {
      firebaseUID = null,
      email = "",
      name = "",
      phone = "",
      profileImage = "",
      referralCode,
      referredBy,

      // ✅ NEW: payout details (optional)
      payoutDetails = {},
    } = req.body;

    // ✅ Normalize
    const safeFirebaseUID = firebaseUID ? String(firebaseUID).trim() : null;
    const safeEmail = email ? String(email).trim().toLowerCase() : "";
    const safePhone = phone ? String(phone).trim() : "";
    const safeName = name ? String(name).trim() : "";
    const safeProfileImage = profileImage ? String(profileImage).trim() : "";

    // ✅ Normalize payout details (optional)
    const bank = payoutDetails?.bank || {};
    const upi = payoutDetails?.upi || {};

    const safeAccountHolderName = bank?.accountHolderName
      ? String(bank.accountHolderName).trim()
      : "";
    const safeAccountNumber = bank?.accountNumber
      ? String(bank.accountNumber).trim()
      : "";
    const safeIfscCode = bank?.ifscCode
      ? String(bank.ifscCode).trim().toUpperCase()
      : "";
    const safeUpiId = upi?.upiId ? String(upi.upiId).trim().toLowerCase() : "";

    const hasPayout =
      !!safeAccountHolderName ||
      !!safeAccountNumber ||
      !!safeIfscCode ||
      !!safeUpiId;

    // ✅ Referral Code (only used on insert)
    const finalReferralCode =
      referralCode ||
      Math.random().toString(36).substring(2, 10).toUpperCase();

    // ✅ helper: send onboarding mail (only if email exists + mail enabled)
    const sendOnboardingIfPossible = async (customer) => {
      try {
        if (process.env.MAIL_ENABLED !== "true") {
          console.log("📭 Onboarding skipped: MAIL_ENABLED not true");
          return;
        }

        if (!customer?.email) {
          console.log("📭 Onboarding skipped: customer.email missing");
          return;
        }

        await Mailer.sendUserOnboarding({
          to: customer.email,
          name: customer?.name || "Customer",
          ctaUrl: `${process.env.CLIENT_URL}/account`,
          brandName: "Miray Fashions",
          supportEmail: process.env.MAIL_REPLY_TO || "support@mirayfashions.com",
        });

        console.log(`✅ Onboarding email sent to: ${customer.email}`);
      } catch (err) {
        console.error("❌ Onboarding Mail Error FULL:", err);
      }
    };

    // ---------------------------------------------------------
    // ✅ Guard: Guest must have email or phone
    // ---------------------------------------------------------
    if (!safeFirebaseUID && !safeEmail && !safePhone) {
      return res.status(400).json({
        message: "Email or phone is required for guest checkout",
      });
    }

    // ---------------------------------------------------------
    // ✅ OPTIONAL: Link guest/email record with firebaseUID (if uid doc doesn't exist)
    // ---------------------------------------------------------
    if (safeFirebaseUID && safeEmail) {
      const uidExists = await Customer.findOne({ firebaseUID: safeFirebaseUID })
        .select("_id")
        .lean();

      if (!uidExists) {
        await Customer.updateOne(
          {
            email: safeEmail,
            $or: [
              { firebaseUID: null },
              { firebaseUID: "" },
              { firebaseUID: { $exists: false } },
            ],
          },
          { $set: { firebaseUID: safeFirebaseUID, updatedAt: new Date() } }
        );
      }
    }

    // ---------------------------------------------------------
    // ✅ ATOMIC UPSERT FILTER
    // Priority: firebaseUID -> else email/phone
    // ---------------------------------------------------------
    const filter = safeFirebaseUID
      ? { firebaseUID: safeFirebaseUID }
      : {
          $or: [
            ...(safeEmail ? [{ email: safeEmail }] : []),
            ...(safePhone ? [{ phone: safePhone }] : []),
          ],
        };

    // ✅ Pre-check for onboarding + created/updated status
    const before = await Customer.findOne(filter).select("email").lean();
    const wasCreated = !before;
    const wasEmailMissingBefore = !before?.email;

    const isOAuth = !!safeFirebaseUID;

    // ---------------------------------------------------------
    // ✅ Update policy (NO overlap with $setOnInsert)
    // ---------------------------------------------------------
    const $set = { updatedAt: new Date() };

    if (isOAuth) {
      if (safeEmail) $set.email = safeEmail;
      if (safeName) $set.name = safeName;
      if (safePhone) $set.phone = safePhone;
      if (safeProfileImage) $set.profileImage = safeProfileImage;
    } else {
      if (safeName) $set.name = safeName;
      if (safeEmail) $set.email = safeEmail;
      if (safePhone) $set.phone = safePhone;
      if (safeProfileImage) $set.profileImage = safeProfileImage;
    }

    // ✅ NEW: payout details (optional updates)
    if (safeAccountHolderName)
      $set["payoutDetails.bank.accountHolderName"] = safeAccountHolderName;

    if (safeAccountNumber)
      $set["payoutDetails.bank.accountNumber"] = safeAccountNumber;

    if (safeIfscCode) $set["payoutDetails.bank.ifscCode"] = safeIfscCode;

    if (safeUpiId) $set["payoutDetails.upi.upiId"] = safeUpiId;

    if (hasPayout) $set["payoutDetails.updatedAt"] = new Date();

    // ✅ Insert-only defaults (do NOT include email/phone/name/profileImage here)
    const $setOnInsert = {
      firebaseUID: safeFirebaseUID || null,
      referralCode: finalReferralCode,
      referredBy: referredBy || null,
      cart: {
        activeCartId: null,
        activeCartType: "cart",
        cartCount: 0,
        abandonedCartCount: 0,
        lastCartActivityAt: null,
        lastAbandonedCartId: null,
      },
      joinedAt: new Date(),
      createdAt: new Date(),
      isActive: true,
    };

    let customer;

    try {
      // ✅ Use normal mongoose return (avoid rawResult shape surprises)
      customer = await Customer.findOneAndUpdate(
        filter,
        { $set, $setOnInsert },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
          runValidators: true,
        }
      );
    } catch (err) {
      // ✅ Handle duplicate key race condition safely
      if (err?.code === 11000) {
        const fallback = await Customer.findOne(filter);
        if (fallback) {
          return res.status(200).json({
            message: "Customer already exists",
            customer: fallback,
          });
        }
      }
      throw err;
    }

    if (!customer?._id) {
      return res.status(500).json({
        message: "Customer upsert failed",
        error: "Customer document not returned from DB",
      });
    }

    // ✅ Onboarding rule
    if (
      customer?.email &&
      (wasCreated || (wasEmailMissingBefore && !!customer.email))
    ) {
      sendOnboardingIfPossible(customer);
    }

    return res.status(wasCreated ? 201 : 200).json({
      message: wasCreated ? "Customer created" : "Customer updated",
      customer,
    });
  } catch (error) {
    console.error("Create Customer Error FULL:", error);

    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};







/**
 * ---------------------------------------------------------
 * ✅ Get customer by customerId
 * @route GET /api/customers/by-customer-id/:customerId
 * ---------------------------------------------------------
 */
export const getCustomerByCustomerId = async (req, res) => {
  try {
    const { customerId } = req.params;

    const customer = await Customer.findOne({ customerId }).lean();

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json(customer);
  } catch (err) {
    console.error("Get Customer By CustomerId Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

/**
 * ---------------------------------------------------------
 * ✅ Get customer by firebaseUID
 * @route GET /api/customers/by-firebase/:firebaseUID
 * ---------------------------------------------------------
 */
export const getCustomerByFirebaseUID = async (req, res) => {
  try {
    const { firebaseUID } = req.params;

    const customer = await Customer.findOne({ firebaseUID }).lean();

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json(customer);
  } catch (err) {
    console.error("Get Customer By FirebaseUID Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

/**
 * ---------------------------------------------------------
 * ✅ Get all customers with filters + search
 * @route GET /api/customers
 * ---------------------------------------------------------
 */
export const getAllCustomers = async (req, res) => {
  try {
    const {
      search,
      country,
      ageGroup,
      isActive,
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {
      ...(country && { country }),
      ...(ageGroup && { ageGroup }),
      ...(isActive !== undefined && { isActive: isActive === "true" }),
      ...(search && {
        $or: [
          { name: new RegExp(search, "i") },
          { email: new RegExp(search, "i") },
          { phone: new RegExp(search, "i") },
          { customerId: new RegExp(search, "i") },
          { firebaseUID: new RegExp(search, "i") },
        ],
      }),
    };

    const safeLimit = Math.min(100, Math.max(1, Number(limit)));
    const skip = (Number(page) - 1) * safeLimit;

    const [items, total] = await Promise.all([
      Customer.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      Customer.countDocuments(filter),
    ]);

    res.json({
      items,
      total,
      page: Number(page),
      pages: Math.ceil(total / safeLimit),
    });
  } catch (err) {
    console.error("Get Customers Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

/**
 * ---------------------------------------------------------
 * ✅ Get single customer (populated)
 * @route GET /api/customers/:id
 * ---------------------------------------------------------
 */
export const getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id)
      .populate("referredBy", "name email")
      .populate("preferences.categories", "name");

    if (!customer)
      return res.status(404).json({ message: "Customer not found" });

    res.json(customer);
  } catch (error) {
    console.error("Get Customer Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * ---------------------------------------------------------
 * ✅ Update customer profile/preferences
 * @route PUT /api/customers/:id
 * ---------------------------------------------------------
 */
export const updateCustomer = async (req, res) => {
  try {
    const payload = { ...req.body };

    // ❌ never allow these from client
    delete payload.firebaseUID;
    delete payload.customerId;
    delete payload.cart;
    delete payload.analytics;

    // ✅ OPTIONAL: whitelist to avoid updating random fields
    const ALLOWED_TOP_LEVEL = [
      "name",
      "email",
      "phone",
      "profileImage",
      "dateOfBirth",
      "gender",
      "country",
      "state",
      "city",
      "preferences",
      "referralCode",
      "referredBy",
      "isActive",

      // ✅ NEW
      "payoutDetails",
    ];

    for (const k of Object.keys(payload)) {
      if (!ALLOWED_TOP_LEVEL.includes(k)) delete payload[k];
    }

    // ✅ Normalize payoutDetails (optional) + set payoutDetails.updatedAt only if payoutDetails provided
    if (payload.payoutDetails) {
      const bank = payload?.payoutDetails?.bank || {};
      const upi = payload?.payoutDetails?.upi || {};

      const safeAccountHolderName = bank?.accountHolderName
        ? String(bank.accountHolderName).trim()
        : "";
      const safeAccountNumber = bank?.accountNumber
        ? String(bank.accountNumber).trim()
        : "";
      const safeIfscCode = bank?.ifscCode
        ? String(bank.ifscCode).trim().toUpperCase()
        : "";
      const safeUpiId = upi?.upiId ? String(upi.upiId).trim().toLowerCase() : "";

      // rebuild payoutDetails so only expected fields go in
      payload.payoutDetails = {
        bank: {
          accountHolderName: safeAccountHolderName,
          accountNumber: safeAccountNumber,
          ifscCode: safeIfscCode,
        },
        upi: { upiId: safeUpiId },
        updatedAt: new Date(),
      };
    }

    payload.updatedAt = new Date();

    const customer = await Customer.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json({ message: "Customer updated", customer });
  } catch (err) {
    console.error("Update Customer Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

/**
 * ---------------------------------------------------------
 * ✅ Update analytics fields
 * @route PATCH /api/customers/:id/analytics
 * ---------------------------------------------------------
 */
export const updateCustomerAnalytics = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const allowed = [
      "totalOrders",
      "totalSpend",
      "wishlistCount",
      "couponUses",
      "creditsEarned",
    ];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        customer.analytics[key] = Number(req.body[key]) || 0;
      }
    }

    const { totalOrders, totalSpend } = customer.analytics;
    customer.analytics.avgOrderValue =
      totalOrders > 0 ? totalSpend / totalOrders : 0;

    await customer.save();

    res.json({
      message: "Analytics updated",
      customer,
    });
  } catch (err) {
    console.error("Update Analytics Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

/**
 * ---------------------------------------------------------
 * ✅ Delete customer
 * @route DELETE /api/customers/:id
 * ---------------------------------------------------------
 */
export const deleteCustomer = async (req, res) => {
  try {
    const deleted = await Customer.findByIdAndDelete(req.params.id);

    if (!deleted)
      return res.status(404).json({ message: "Customer not found" });

    res.json({ message: "Customer deleted successfully" });
  } catch (error) {
    console.error("Delete Customer Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * ---------------------------------------------------------
 * ✅ Check if customer exists (email/phone)
 * @route GET /api/customers/exists
 * @access Public
 * ---------------------------------------------------------
 */
export const checkCustomerExists = async (req, res) => {
  try {
    const { email = "", phone = "" } = req.query;

    const safeEmail = email ? String(email).trim().toLowerCase() : "";
    const safePhone = phone ? String(phone).trim() : "";

    if (!safeEmail && !safePhone) {
      return res.status(400).json({
        message: "Email or phone is required",
        exists: false,
      });
    }

    const query = {
      $or: [
        ...(safeEmail ? [{ email: safeEmail }] : []),
        ...(safePhone ? [{ phone: safePhone }] : []),
      ],
    };

    const customer = await Customer.findOne(query)
      .select("_id email phone name firebaseUID")
      .lean();

    return res.status(200).json({
      exists: !!customer,
      customer: customer || null,
    });
  } catch (err) {
    console.error("Check Customer Exists Error:", err);
    return res.status(500).json({
      message: "Server error",
      exists: false,
      error: err.message,
    });
  }
};

/**
 * ---------------------------------------------------------
 * ✅ Add Cart Add (productCode) by customer _id
 * @route POST /api/customers/:id/cart-adds/add
 * Body: { productCode }
 * ---------------------------------------------------------
 */
export const addCartAddByCustomerId = async (req, res) => {
  try {
    const { id } = req.params;
    const { productCode = "", variantId = null, size = "" } = req.body;

    const code = String(productCode || "").trim();
    const sz = String(size || "").trim();
    const vId = variantId ? String(variantId).trim() : null;

    if (!code) return res.status(400).json({ message: "productCode is required" });
    // ✅ at least one identifier for variant products (optional for simple)
    if (!vId && !sz) {
      // allow simple product to track just by productCode
      // but if you want strict variant tracking, uncomment:
      // return res.status(400).json({ message: "variantId or size is required" });
    }

    const customer = await Customer.findById(id);
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    customer.cartAdds = Array.isArray(customer.cartAdds) ? customer.cartAdds : [];

    const sameKey = (x) =>
      String(x?.productCode || "").trim() === code &&
      (vId
        ? String(x?.variantId || "") === vId
        : String(x?.size || "").trim() === sz) &&
      // ✅ if neither vId nor sz provided, match only by productCode (simple)
      (vId || sz ? true : true);

    // ✅ remove existing same key
    customer.cartAdds = customer.cartAdds.filter((x) => !sameKey(x));

    // ✅ add to front (recent-first)
    customer.cartAdds.unshift({
      productCode: code,
      variantId: vId || null,
      size: sz || "",
      lastAddedAt: new Date(),
    });

    // ✅ cap list
    customer.cartAdds = customer.cartAdds.slice(0, 80);

    await customer.save();

    return res.status(200).json({
      message: "cartAdds updated",
      cartAdds: customer.cartAdds,
    });
  } catch (err) {
    console.error("Add CartAdd Error:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};


/**
 * ---------------------------------------------------------
 * ✅ Remove Cart Add (productCode) by customer _id
 * @route POST /api/customers/:id/cart-adds/remove
 * Body: { productCode }
 * ---------------------------------------------------------
 */
export const removeCartAddByCustomerId = async (req, res) => {
  try {
    const { id } = req.params;
    const { productCode = "", variantId = null, size = "" } = req.body;

    const code = String(productCode || "").trim();
    const sz = String(size || "").trim();
    const vId = variantId ? String(variantId).trim() : null;

    if (!code) return res.status(400).json({ message: "productCode is required" });

    const customer = await Customer.findById(id);
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    customer.cartAdds = Array.isArray(customer.cartAdds) ? customer.cartAdds : [];

    const shouldRemove = (x) => {
      if (String(x?.productCode || "").trim() !== code) return false;

      // ✅ if variantId provided: match by variantId
      if (vId) return String(x?.variantId || "") === vId;

      // ✅ else if size provided: match by size
      if (sz) return String(x?.size || "").trim() === sz;

      // ✅ else (simple): remove all entries for productCode
      return true;
    };

    const before = customer.cartAdds.length;
    customer.cartAdds = customer.cartAdds.filter((x) => !shouldRemove(x));
    const after = customer.cartAdds.length;

    if (before !== after) await customer.save();

    return res.status(200).json({
      message: "cartAdds updated",
      removed: before !== after,
      cartAdds: customer.cartAdds,
    });
  } catch (err) {
    console.error("Remove CartAdd Error:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};


/**
 * ---------------------------------------------------------
 * ✅ Merge Guest Cart Adds after login (customer _id)
 * @route POST /api/customers/:id/cart-adds/merge
 * Body: { productCodes: ["00131","00218"] }
 * ---------------------------------------------------------
 */
export const mergeGuestCartAddsByCustomerId = async (req, res) => {
  try {
    const { id } = req.params;
    const { items = [] } = req.body;

    const normItems = (Array.isArray(items) ? items : [])
      .map((it) => {
        const productCode = String(it?.productCode || "").trim();
        const variantId = it?.variantId ? String(it.variantId).trim() : null;
        const size = String(it?.size || "").trim();
        const lastAddedAt = it?.lastAddedAt ? new Date(it.lastAddedAt) : new Date();
        if (!productCode) return null;
        return { productCode, variantId, size, lastAddedAt };
      })
      .filter(Boolean);

    if (!normItems.length) {
      return res.status(200).json({ message: "Nothing to merge", cartAdds: [] });
    }

    const customer = await Customer.findById(id);
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    const existing = Array.isArray(customer.cartAdds) ? customer.cartAdds : [];

    // ✅ helper: unique key
    const keyOf = (x) => {
      const code = String(x?.productCode || "").trim();
      const vId = x?.variantId ? String(x.variantId) : "";
      const sz = String(x?.size || "").trim();
      return `${code}::${vId || "-"}::${sz || "-"}`;
    };

    // ✅ build map by recency (guest first, then existing)
    const m = new Map();

    const addToMap = (x) => {
      const k = keyOf(x);
      const prev = m.get(k);
      const t = x?.lastAddedAt ? new Date(x.lastAddedAt).getTime() : Date.now();
      const pt = prev?.lastAddedAt ? new Date(prev.lastAddedAt).getTime() : 0;

      // keep latest timestamp
      if (!prev || t > pt) {
        m.set(k, {
          productCode: String(x.productCode).trim(),
          variantId: x.variantId ? String(x.variantId) : null,
          size: String(x.size || "").trim(),
          lastAddedAt: x.lastAddedAt ? new Date(x.lastAddedAt) : new Date(),
        });
      }
    };

    normItems.forEach(addToMap);
    existing.forEach(addToMap);

    // ✅ sort by lastAddedAt desc + cap 80
    const merged = Array.from(m.values())
      .sort((a, b) => new Date(b.lastAddedAt) - new Date(a.lastAddedAt))
      .slice(0, 80);

    customer.cartAdds = merged;
    await customer.save();

    return res.status(200).json({
      message: "cartAdds merged",
      cartAdds: customer.cartAdds,
    });
  } catch (err) {
    console.error("Merge Guest CartAdds Error:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};


/**
 * ---------------------------------------------------------
 * ✅ Add / Update Customer Banking Details (Bank OR UPI)
 * @route PATCH /api/customers/:id/payout-details
 * Body:
 *  - Bank: { bank: { accountHolderName, accountNumber, ifscCode } }
 *  - UPI:  { upi: { upiId } }
 *  - Or both
 * Notes:
 *  - Either UPI or Bank must be provided (at least one)
 *  - Fields are optional individually, but must form a valid payload for that method
 * ---------------------------------------------------------
 */
export const addCustomerBankingDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const bankIn = req.body?.bank || req.body?.payoutDetails?.bank || {};
    const upiIn = req.body?.upi || req.body?.payoutDetails?.upi || {};

    const accountHolderName = bankIn?.accountHolderName
      ? String(bankIn.accountHolderName).trim()
      : "";
    const accountNumber = bankIn?.accountNumber
      ? String(bankIn.accountNumber).trim()
      : "";
    const ifscCode = bankIn?.ifscCode
      ? String(bankIn.ifscCode).trim().toUpperCase()
      : "";

    const upiId = upiIn?.upiId ? String(upiIn.upiId).trim().toLowerCase() : "";

    const hasAnyBank = !!(accountHolderName || accountNumber || ifscCode);
    const hasUpi = !!upiId;

    // ✅ Must send at least one method
    if (!hasAnyBank && !hasUpi) {
      return res.status(400).json({
        message: "Provide either UPI ID or Bank account details",
      });
    }

    // ✅ If bank method used, enforce required bank fields
    if (hasAnyBank) {
      if (!accountHolderName || !accountNumber || !ifscCode) {
        return res.status(400).json({
          message:
            "For bank details, accountHolderName, accountNumber and ifscCode are required",
        });
      }
    }

    // ✅ Build safe $set (update only what is provided)
    const $set = {
      updatedAt: new Date(),
      "payoutDetails.updatedAt": new Date(),
    };

    if (hasAnyBank) {
      $set["payoutDetails.bank.accountHolderName"] = accountHolderName;
      $set["payoutDetails.bank.accountNumber"] = accountNumber;
      $set["payoutDetails.bank.ifscCode"] = ifscCode;
    }

    if (hasUpi) {
      $set["payoutDetails.upi.upiId"] = upiId;
    }

    const customer = await Customer.findByIdAndUpdate(
      id,
      { $set },
      { new: true, runValidators: true }
    );

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    return res.status(200).json({
      message: "Payout details updated",
      payoutDetails: customer.payoutDetails,
      customer,
    });
  } catch (err) {
    console.error("Add Customer Banking Details Error:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};
