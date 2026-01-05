import Customer from "./Customer.js";

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

    const safeEmail = email ? String(email).trim().toLowerCase() : "";
    const safePhone = phone ? String(phone).trim() : "";

    // ✅ referral code fallback
    const finalReferralCode =
      referralCode ||
      Math.random().toString(36).substring(2, 10).toUpperCase();

    /**
     * ---------------------------------------------------------
     * ✅ CASE 1: Firebase Login (OAuth)
     * ---------------------------------------------------------
     */
    if (firebaseUID) {
      // ✅ find by firebaseUID
      let customer = await Customer.findOne({ firebaseUID });

      if (customer) {
        // ✅ update login/profile fields
        if (safeEmail) customer.email = safeEmail;
        if (name) customer.name = name;
        if (safePhone) customer.phone = safePhone;
        if (profileImage) customer.profileImage = profileImage;

        await customer.save();

        return res.status(200).json({
          message: "Customer updated",
          customer,
        });
      }

      /**
       * ✅ Edge Case: If firebaseUID not found but email already exists
       * link that customer to firebaseUID
       */
      if (safeEmail) {
        const existingByEmail = await Customer.findOne({ email: safeEmail });

        if (existingByEmail) {
          existingByEmail.firebaseUID = firebaseUID;
          if (name) existingByEmail.name = name;
          if (safePhone) existingByEmail.phone = safePhone;
          if (profileImage) existingByEmail.profileImage = profileImage;

          await existingByEmail.save();

          return res.status(200).json({
            message: "Customer linked to firebase login",
            customer: existingByEmail,
          });
        }
      }

      // ✅ create fresh customer for firebase login
      customer = await Customer.create({
        firebaseUID,
        email: safeEmail,
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

      return res.status(201).json({
        message: "Customer created",
        customer,
      });
    }

    /**
     * ---------------------------------------------------------
     * ✅ CASE 2: Guest Checkout (no firebaseUID)
     * ---------------------------------------------------------
     * ✅ Find OR Create customer by email/phone safely
     */

    // ✅ must have at least email OR phone
    if (!safeEmail && !safePhone) {
      return res.status(400).json({
        message: "Email or phone is required for guest checkout",
      });
    }

    // ✅ Find by email OR phone (both checked)
    let existingCustomer = await Customer.findOne({
      $or: [
        ...(safeEmail ? [{ email: safeEmail }] : []),
        ...(safePhone ? [{ phone: safePhone }] : []),
      ],
    });

    if (existingCustomer) {
      // ✅ fill missing fields silently (NO overwrite)
      if (name && !existingCustomer.name) existingCustomer.name = name;
      if (safeEmail && !existingCustomer.email)
        existingCustomer.email = safeEmail;
      if (safePhone && !existingCustomer.phone)
        existingCustomer.phone = safePhone;
      if (profileImage && !existingCustomer.profileImage)
        existingCustomer.profileImage = profileImage;

      await existingCustomer.save();

      return res.status(200).json({
        message: "Guest customer already exists",
        customer: existingCustomer,
      });
    }

    /**
     * ✅ Create new guest customer
     * ✅ Handle race condition duplicate key safely
     */
    try {
      const guestCustomer = await Customer.create({
        firebaseUID: null,
        email: safeEmail,
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

      return res.status(201).json({
        message: "Guest customer created",
        customer: guestCustomer,
      });
    } catch (err) {
      // ✅ race condition: duplicate key created by another request
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
    console.error("Create Customer Error:", error);

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
