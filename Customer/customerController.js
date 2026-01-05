import Customer from "./Customer.js";

/**
 * Create or update customer (OAuth login + Guest Checkout)
 * @route POST /api/customers
 * @access Public
 */
export const createCustomer = async (req, res) => {
  try {
    const {
      firebaseUID = null,
      email,
      name = "",
      phone = "",
      profileImage = "",
      referralCode,
      referredBy,
    } = req.body;

    const safeEmail = email ? String(email).trim().toLowerCase() : "";
    const safePhone = phone ? String(phone).trim() : "";

    /**
     * ✅ CASE 1: Firebase Login (OAuth)
     */
    if (firebaseUID) {
      let customer = await Customer.findOne({ firebaseUID });

      if (customer) {
        // Update only login/profile fields
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

      // Create new user with firebaseUID
      const finalReferralCode =
        referralCode ||
        Math.random().toString(36).substring(2, 10).toUpperCase();

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
     * ✅ CASE 2: Guest Checkout (no firebaseUID)
     * We still create a customer so we have customerId for orders.
     */
    let existingCustomer = null;

    // ✅ Optional: If guest provides email/phone, try to find existing customer
    if (safeEmail) {
      existingCustomer = await Customer.findOne({ email: safeEmail });
    } else if (safePhone) {
      existingCustomer = await Customer.findOne({ phone: safePhone });
    }

    if (existingCustomer) {
      // ✅ Update minimal fields if new guest info provided
      if (name && !existingCustomer.name) existingCustomer.name = name;
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

    // ✅ Create new guest customer
    const finalReferralCode =
      referralCode ||
      Math.random().toString(36).substring(2, 10).toUpperCase();

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
  } catch (error) {
    console.error("Create Customer Error:", error);

    // handle duplicate safely
    if (error?.code === 11000) {
      const field = Object.keys(error.keyValue || {})[0] || "field";
      return res.status(409).json({
        message: `${field} already exists`,
      });
    }

    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * ✅ NEW: Get customer by customerId (0001, 0002...)
 * @route GET /api/customers/by-customer-id/:customerId
 * @access Admin
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
 * ✅ NEW: Get customer by firebaseUID
 * @route GET /api/customers/by-firebase/:firebaseUID
 * @access Admin
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
 * Get all customers with optional filters + search
 * @route GET /api/customers
 * @access Admin
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
          { firebaseUID: new RegExp(search, "i") }, // ✅ now searchable
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
 * Get a single customer with populated refs
 * @route GET /api/customers/:id
 * @access Admin
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
 * Update customer profile/preferences
 * @route PUT /api/customers/:id
 * @access Private
 */
export const updateCustomer = async (req, res) => {
  try {
    const payload = { ...req.body };

    // ❌ protect system-controlled fields
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
 * Update analytics (orders, spend, wishlist, credits)
 * @route PATCH /api/customers/:id/analytics
 * @access System/Admin
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

    // update only whitelisted analytics fields
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        customer.analytics[key] = Number(req.body[key]) || 0;
      }
    }

    // auto-calc AOV
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
 * Delete a customer
 * @route DELETE /api/customers/:id
 * @access Admin
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
