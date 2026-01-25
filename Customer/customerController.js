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
const buildSafeUpdate = ({ email, phone, name, profileImage }) => {
  const $set = {};

  // keep these as "always update if provided" (your choice)
  if (email) $set.email = email;
  if (phone) $set.phone = phone;
  if (name) $set.name = name;
  if (profileImage) $set.profileImage = profileImage;

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
    } = req.body;

    // ✅ Normalize
    const safeFirebaseUID = firebaseUID ? String(firebaseUID).trim() : null;
    const safeEmail = email ? String(email).trim().toLowerCase() : "";
    const safePhone = phone ? String(phone).trim() : "";
    const safeName = name ? String(name).trim() : "";
    const safeProfileImage = profileImage ? String(profileImage).trim() : "";

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

    delete payload.firebaseUID;
    delete payload.customerId;
    delete payload.cart;
    delete payload.analytics;

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
    const { productCode = "" } = req.body;

    const code = String(productCode || "").trim();
    if (!code) {
      return res.status(400).json({ message: "productCode is required" });
    }

    const customer = await Customer.findById(id);
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    // ✅ ensure array
    customer.cartAdds = Array.isArray(customer.cartAdds) ? customer.cartAdds : [];

    // ✅ remove if already exists
    customer.cartAdds = customer.cartAdds.filter((x) => x?.productCode !== code);

    // ✅ add to front (recent-first)
    customer.cartAdds.unshift({
      productCode: code,
      lastAddedAt: new Date(),
    });

    // ✅ cap list (keep light)
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
    const { productCode = "" } = req.body;

    const code = String(productCode || "").trim();
    if (!code) {
      return res.status(400).json({ message: "productCode is required" });
    }

    const customer = await Customer.findById(id);
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    customer.cartAdds = Array.isArray(customer.cartAdds) ? customer.cartAdds : [];

    const before = customer.cartAdds.length;
    customer.cartAdds = customer.cartAdds.filter((x) => x?.productCode !== code);
    const after = customer.cartAdds.length;

    if (before !== after) {
      await customer.save();
    }

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
    const { productCodes = [] } = req.body;

    const codes = (Array.isArray(productCodes) ? productCodes : [])
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    if (!codes.length) {
      return res.status(200).json({
        message: "Nothing to merge",
        cartAdds: [],
      });
    }

    const customer = await Customer.findById(id);
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    customer.cartAdds = Array.isArray(customer.cartAdds) ? customer.cartAdds : [];

    // existing codes from DB
    const existing = customer.cartAdds
      .map((x) => String(x?.productCode || "").trim())
      .filter(Boolean);

    // ✅ guest recent-first, then existing
    const mergedUnique = [...codes, ...existing]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 80);

    // ✅ rebuild with fresh timestamps (simple)
    customer.cartAdds = mergedUnique.map((c) => ({
      productCode: c,
      lastAddedAt: new Date(),
    }));

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
