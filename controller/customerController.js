import Customer from "../models/Customer.js";

/**
 * Create or update customer (ideal for OAuth logins)
 * @route POST /api/customers
 * @access Public (after Firebase login)
 */
export const createCustomer = async (req, res) => {
  try {
    const { firebaseUID, email, name = "", phone = "", profileImage = "" } = req.body;

    // firebaseUID is the only mandatory field for OAuth users
    if (!firebaseUID) {
      return res.status(400).json({ message: "Firebase UID is required." });
    }

    // If customer already exists → update login details only
    let customer = await Customer.findOne({ firebaseUID });

    if (customer) {
      customer.email = email || customer.email;
      customer.name = name || customer.name;
      customer.phone = phone || customer.phone;
      customer.profileImage = profileImage || customer.profileImage;

      await customer.save();
      return res.status(200).json({ message: "Customer updated", customer });
    }

    // Generate referral code if missing
    const referralCode =
      req.body.referralCode || Math.random().toString(36).substring(2, 10).toUpperCase();

    // Create new customer
    customer = await Customer.create({
      firebaseUID,
      email,
      name,
      phone,
      profileImage,
      referralCode,
      referredBy: req.body.referredBy || null,
    });

    res.status(201).json({ message: "Customer created", customer });
  } catch (error) {
    console.error("Create Customer Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};


/**
 * Get all customers with optional filters + search
 * @route GET /api/customers
 * @access Admin
 */
export const getAllCustomers = async (req, res) => {
  try {
    const { search, country, isActive, ageGroup } = req.query;
    const filters = {};

    if (country) filters.country = country;
    if (ageGroup) filters.ageGroup = ageGroup;
    if (isActive !== undefined) filters.isActive = isActive === "true";

    // Search by name/email/phone
    if (search) {
      filters.$or = [
        { name: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
        { phone: new RegExp(search, "i") },
      ];
    }

    const customers = await Customer.find(filters).sort({ createdAt: -1 });
    res.json(customers);
  } catch (error) {
    console.error("Get Customers Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
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

    if (!customer) return res.status(404).json({ message: "Customer not found" });

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
    const updated = await Customer.findByIdAndUpdate(
      req.params.id,
      { ...req.body },
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ message: "Customer not found" });

    res.json({ message: "Customer updated", customer: updated });
  } catch (error) {
    console.error("Update Customer Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
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
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    const analytics = customer.analytics;

    // Update only provided fields
    Object.assign(analytics, req.body);

    // Auto-calc Avg Order Value
    if (analytics.totalOrders > 0) {
      analytics.avgOrderValue = analytics.totalSpend / analytics.totalOrders;
    }

    await customer.save();

    res.json({
      message: "Analytics updated",
      customer,
    });
  } catch (error) {
    console.error("Update Analytics Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
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
    if (!deleted) return res.status(404).json({ message: "Customer not found" });

    res.json({ message: "Customer deleted successfully" });
  } catch (error) {
    console.error("Delete Customer Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
