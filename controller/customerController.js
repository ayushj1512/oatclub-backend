import Customer from "../models/Customer.js";

/**
 * @desc Create a new customer
 * @route POST /api/customers
 * @access Public / Authenticated (after Firebase login)
 */
export const createCustomer = async (req, res) => {
  try {
    const {
      firebaseUID,
      name,
      email,
      phone,
      profileImage,
      dateOfBirth,
      gender,
      country,
      state,
      city,
      referralCode,
      referredBy,
    } = req.body;

    if (!firebaseUID || !name || !email) {
      return res.status(400).json({ message: "Firebase UID, name, and email are required." });
    }

    // Check if already exists
    const existing = await Customer.findOne({ $or: [{ firebaseUID }, { email }] });
    if (existing) {
      return res.status(409).json({ message: "Customer already exists." });
    }

    // Generate referral code (if not provided)
    const generatedCode = referralCode || Math.random().toString(36).substring(2, 10).toUpperCase();

    const newCustomer = await Customer.create({
      firebaseUID,
      name,
      email,
      phone,
      profileImage,
      dateOfBirth,
      gender,
      country,
      state,
      city,
      referralCode: generatedCode,
      referredBy,
    });

    res.status(201).json({ message: "Customer created successfully", customer: newCustomer });
  } catch (error) {
    console.error("Error creating customer:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get all customers (with filters)
 * @route GET /api/customers
 * @access Private (Admin)
 */
export const getAllCustomers = async (req, res) => {
  try {
    const { country, isActive, ageGroup, search } = req.query;
    const filters = {};

    if (country) filters.country = country;
    if (isActive !== undefined) filters.isActive = isActive === "true";
    if (ageGroup) filters.ageGroup = ageGroup;

    // search by name/email/phone
    if (search) {
      filters.$or = [
        { name: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
        { phone: new RegExp(search, "i") },
      ];
    }

    const customers = await Customer.find(filters).sort({ createdAt: -1 });
    res.status(200).json(customers);
  } catch (error) {
    console.error("Error fetching customers:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get a single customer by ID
 * @route GET /api/customers/:id
 * @access Private
 */
export const getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id)
      .populate("referredBy", "name email")
      .populate("preferences.categories", "name");

    if (!customer) return res.status(404).json({ message: "Customer not found" });

    res.status(200).json(customer);
  } catch (error) {
    console.error("Error fetching customer:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Update customer profile or preferences
 * @route PUT /api/customers/:id
 * @access Private
 */
export const updateCustomer = async (req, res) => {
  try {
    const {
      name,
      phone,
      profileImage,
      country,
      state,
      city,
      gender,
      dateOfBirth,
      preferences,
      isActive,
    } = req.body;

    const updatedCustomer = await Customer.findByIdAndUpdate(
      req.params.id,
      {
        name,
        phone,
        profileImage,
        country,
        state,
        city,
        gender,
        dateOfBirth,
        preferences,
        isActive,
      },
      { new: true, runValidators: true }
    );

    if (!updatedCustomer) return res.status(404).json({ message: "Customer not found" });

    res.status(200).json({ message: "Customer updated successfully", customer: updatedCustomer });
  } catch (error) {
    console.error("Error updating customer:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Update analytics fields (orders, spend, wishlist etc.)
 * @route PATCH /api/customers/:id/analytics
 * @access Private (System/Admin)
 */
export const updateCustomerAnalytics = async (req, res) => {
  try {
    const { totalOrders, totalSpend, wishlistCount, couponUses, creditsEarned } = req.body;

    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    if (totalOrders !== undefined) customer.analytics.totalOrders = totalOrders;
    if (totalSpend !== undefined) customer.analytics.totalSpend = totalSpend;
    if (wishlistCount !== undefined) customer.analytics.wishlistCount = wishlistCount;
    if (couponUses !== undefined) customer.analytics.couponUses = couponUses;
    if (creditsEarned !== undefined) customer.analytics.creditsEarned = creditsEarned;

    // auto calculate avg order value
    if (customer.analytics.totalOrders > 0) {
      customer.analytics.avgOrderValue =
        customer.analytics.totalSpend / customer.analytics.totalOrders;
    }

    await customer.save();
    res.status(200).json({ message: "Analytics updated successfully", customer });
  } catch (error) {
    console.error("Error updating analytics:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Delete customer account
 * @route DELETE /api/customers/:id
 * @access Private (Admin)
 */
export const deleteCustomer = async (req, res) => {
  try {
    const deleted = await Customer.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Customer not found" });

    res.status(200).json({ message: "Customer deleted successfully" });
  } catch (error) {
    console.error("Error deleting customer:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
