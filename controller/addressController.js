import Address from "../models/addressModel.js";

/**
 * @desc Create new address for a customer
 * @route POST /api/addresses
 */
export const createAddress = async (req, res) => {
  try {
    const { customerId, isDefaultShipping, isDefaultBilling } = req.body;

    if (!customerId) {
      return res.status(400).json({ message: "Customer ID is required" });
    }

    // If this address is marked as default, remove default flag from others
    if (isDefaultShipping) {
      await Address.updateMany(
        { customerId },
        { $set: { isDefaultShipping: false } }
      );
    }
    if (isDefaultBilling) {
      await Address.updateMany(
        { customerId },
        { $set: { isDefaultBilling: false } }
      );
    }

    const newAddress = new Address(req.body);
    const saved = await newAddress.save();

    res.status(201).json({
      success: true,
      message: "Address created successfully",
      data: saved,
    });
  } catch (error) {
    console.error("Error creating address:", error);
    res.status(500).json({ success: false, message: "Server error", error });
  }
};

/**
 * @desc Get all addresses for a customer
 * @route GET /api/addresses/:customerId
 */
export const getAddressesByCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;

    const addresses = await Address.find({ customerId }).sort({
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      count: addresses.length,
      data: addresses,
    });
  } catch (error) {
    console.error("Error fetching addresses:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc Get a single address by ID
 * @route GET /api/addresses/single/:id
 */
export const getAddressById = async (req, res) => {
  try {
    const address = await Address.findById(req.params.id);
    if (!address) {
      return res.status(404).json({ message: "Address not found" });
    }

    res.status(200).json({ success: true, data: address });
  } catch (error) {
    console.error("Error fetching address:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc Update an existing address
 * @route PUT /api/addresses/:id
 */
export const updateAddress = async (req, res) => {
  try {
    const { isDefaultShipping, isDefaultBilling, customerId } = req.body;

    // Handle default address logic
    if (isDefaultShipping && customerId) {
      await Address.updateMany(
        { customerId },
        { $set: { isDefaultShipping: false } }
      );
    }

    if (isDefaultBilling && customerId) {
      await Address.updateMany(
        { customerId },
        { $set: { isDefaultBilling: false } }
      );
    }

    const updated = await Address.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      return res.status(404).json({ message: "Address not found" });
    }

    res.status(200).json({
      success: true,
      message: "Address updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("Error updating address:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc Delete an address
 * @route DELETE /api/addresses/:id
 */
export const deleteAddress = async (req, res) => {
  try {
    const deleted = await Address.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: "Address not found" });
    }

    res.status(200).json({
      success: true,
      message: "Address deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting address:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
