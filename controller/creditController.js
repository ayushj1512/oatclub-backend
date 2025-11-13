import Credit from "../models/Credit.js";
import Customer from "../models/Customer.js";

/**
 * @desc Create a new credit entry for a customer
 * @route POST /api/credits
 * @access Private (Admin)
 */
export const createCredit = async (req, res) => {
  try {
    const { customerId, creditType, amount, description, sourceRef, expiryDate, issuedBy } = req.body;

    if (!customerId || !creditType || !amount)
      return res.status(400).json({ message: "Customer ID, credit type, and amount are required." });

    // Optional: validate customer existence
    const customerExists = await Customer.findById(customerId);
    if (!customerExists)
      return res.status(404).json({ message: "Customer not found." });

    // Calculate new balance (sum of all active credits)
    const totalActive = await Credit.aggregate([
      { $match: { customerId: customerId, status: "active" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const balanceAfter = (totalActive[0]?.total || 0) + amount;

    const credit = await Credit.create({
      customerId,
      creditType,
      amount,
      balanceAfter,
      description,
      sourceRef,
      expiryDate,
      issuedBy,
    });

    res.status(201).json({ message: "Credit issued successfully", credit });
  } catch (error) {
    console.error("Error creating credit:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get all credits (with optional filters)
 * @route GET /api/credits
 * @access Private (Admin)
 */
export const getAllCredits = async (req, res) => {
  try {
    const { customerId, status, creditType } = req.query;

    const filters = {};
    if (customerId) filters.customerId = customerId;
    if (status) filters.status = status;
    if (creditType) filters.creditType = creditType;

    const credits = await Credit.find(filters)
      .populate("customerId", "name email")
      .populate("issuedBy", "username role")
      .sort({ createdAt: -1 });

    res.status(200).json(credits);
  } catch (error) {
    console.error("Error fetching credits:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get a single credit by ID
 * @route GET /api/credits/:id
 * @access Private
 */
export const getCreditById = async (req, res) => {
  try {
    const credit = await Credit.findById(req.params.id)
      .populate("customerId", "name email")
      .populate("issuedBy", "username role");

    if (!credit) return res.status(404).json({ message: "Credit not found" });

    res.status(200).json(credit);
  } catch (error) {
    console.error("Error fetching credit:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Update a credit (status, expiry, etc.)
 * @route PUT /api/credits/:id
 * @access Private (Admin)
 */
export const updateCredit = async (req, res) => {
  try {
    const { status, amount, expiryDate, description } = req.body;

    const updatedCredit = await Credit.findByIdAndUpdate(
      req.params.id,
      { status, amount, expiryDate, description },
      { new: true, runValidators: true }
    );

    if (!updatedCredit) return res.status(404).json({ message: "Credit not found" });

    res.status(200).json({ message: "Credit updated successfully", updatedCredit });
  } catch (error) {
    console.error("Error updating credit:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Delete a credit record
 * @route DELETE /api/credits/:id
 * @access Private (Admin)
 */
export const deleteCredit = async (req, res) => {
  try {
    const deletedCredit = await Credit.findByIdAndDelete(req.params.id);
    if (!deletedCredit) return res.status(404).json({ message: "Credit not found" });

    res.status(200).json({ message: "Credit deleted successfully" });
  } catch (error) {
    console.error("Error deleting credit:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
