import Customer from "./Customer.js";
import { Mailer } from "../nodemailer/events/mailer.js"; // ✅ adjust relative path if needed

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
    const safeEmail = email ? String(email).trim().toLowerCase() : "";
    const safePhone = phone ? String(phone).trim() : "";

    // ✅ Referral Code
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

    /**
     * ✅ RULE:
     * Send onboarding ONLY when:
     * - New customer created OR
     * - Existing customer had no email before and now email is set
     */

    // ---------------------------------------------------------
    // ✅ CASE 1: Firebase Login (OAuth)
    // ---------------------------------------------------------
    if (firebaseUID) {
      // 1) Find by firebaseUID
      let customer = await Customer.findOne({ firebaseUID });

      // ✅ If exists, update fields (send onboarding ONLY if email was missing and now set)
      if (customer) {
        const wasEmailMissing = !customer.email;

        if (safeEmail) customer.email = safeEmail;
        if (name) customer.name = name;
        if (safePhone) customer.phone = safePhone;
        if (profileImage) customer.profileImage = profileImage;

        await customer.save();

        // ✅ Send onboarding only if email got added now
        if (wasEmailMissing && customer.email) {
          // fire & forget but safe
          sendOnboardingIfPossible(customer);
        }

        return res.status(200).json({
          message: "Customer updated",
          customer,
        });
      }

      // 2) Edge: firebaseUID not found but email exists → link account
      if (safeEmail) {
        const existingByEmail = await Customer.findOne({ email: safeEmail });

        if (existingByEmail) {
          const wasEmailMissing = !existingByEmail.email; // usually false since found by email

          existingByEmail.firebaseUID = firebaseUID;
          if (name) existingByEmail.name = name;
          if (safePhone) existingByEmail.phone = safePhone;
          if (profileImage) existingByEmail.profileImage = profileImage;

          await existingByEmail.save();

          // In linking case, onboarding usually not needed, but safe:
          // if email was missing earlier and now set (rare) -> send
          if (wasEmailMissing && existingByEmail.email) {
            sendOnboardingIfPossible(existingByEmail);
          }

          return res.status(200).json({
            message: "Customer linked to firebase login",
            customer: existingByEmail,
          });
        }
      }

      // 3) Create NEW firebase customer
      customer = await Customer.create({
        firebaseUID,
        email: safeEmail || "", // allow empty if user logged in without email
        name,
        phone: safePhone,
        profileImage,
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
      });

      // ✅ send onboarding (if email exists)
      sendOnboardingIfPossible(customer);

      return res.status(201).json({
        message: "Customer created",
        customer,
      });
    }

    // ---------------------------------------------------------
    // ✅ CASE 2: Guest Checkout (no firebaseUID)
    // ---------------------------------------------------------
    if (!safeEmail && !safePhone) {
      return res.status(400).json({
        message: "Email or phone is required for guest checkout",
      });
    }

    // ✅ Find existing guest by email/phone
    let existingCustomer = await Customer.findOne({
      $or: [
        ...(safeEmail ? [{ email: safeEmail }] : []),
        ...(safePhone ? [{ phone: safePhone }] : []),
      ],
    });

    // ✅ Guest exists → update (send onboarding ONLY if email was missing and now set)
    if (existingCustomer) {
      const wasEmailMissing = !existingCustomer.email;

      if (name && !existingCustomer.name) existingCustomer.name = name;

      if (safeEmail && !existingCustomer.email)
        existingCustomer.email = safeEmail;

      if (safePhone && !existingCustomer.phone)
        existingCustomer.phone = safePhone;

      if (profileImage && !existingCustomer.profileImage)
        existingCustomer.profileImage = profileImage;

      await existingCustomer.save();

      // ✅ send onboarding only if email got added now
      if (wasEmailMissing && existingCustomer.email) {
        sendOnboardingIfPossible(existingCustomer);
      }

      return res.status(200).json({
        message: "Guest customer already exists",
        customer: existingCustomer,
      });
    }

    // ✅ Create NEW guest customer
    try {
      const guestCustomer = await Customer.create({
        firebaseUID: null,
        email: safeEmail || "",
        name,
        phone: safePhone,
        profileImage,
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
      });

      // ✅ send onboarding (if email exists)
      sendOnboardingIfPossible(guestCustomer);

      return res.status(201).json({
        message: "Guest customer created",
        customer: guestCustomer,
      });
    } catch (err) {
      // ✅ Handle duplicate key race condition safely
      if (err?.code === 11000) {
        const fallback = await Customer.findOne({
          $or: [
            ...(safeEmail ? [{ email: safeEmail }] : []),
            ...(safePhone ? [{ phone: safePhone }] : []),
          ],
        });

        if (fallback) {
          return res.status(200).json({
            message: "Guest customer already exists",
            customer: fallback,
          });
        }
      }

      throw err;
    }
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
