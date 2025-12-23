import Address from "./Address.js";

/**
 * ---------------------------------------------------------
 * CREATE NEW ADDRESS
 * @route POST /api/addresses
 * ---------------------------------------------------------
 */
export const createAddress = async (req, res) => {
  try {
    const {
      firebaseUID,
      email,
      customerId,
      isDefaultShipping,
      isDefaultBilling,
    } = req.body;

    if (!firebaseUID || !email || !customerId) {
      return res.status(400).json({
        success: false,
        message: "firebaseUID, email, and customerId are required",
      });
    }

    // If default shipping → remove for others
    if (isDefaultShipping) {
      await Address.updateMany(
        { firebaseUID, email },
        { isDefaultShipping: false }
      );
    }

    // If default billing → remove for others
    if (isDefaultBilling) {
      await Address.updateMany(
        { firebaseUID, email },
        { isDefaultBilling: false }
      );
    }

    const address = await Address.create(req.body);

    res.status(201).json({
      success: true,
      message: "Address created successfully",
      data: address,
    });
  } catch (error) {
    console.error("Error creating address:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ---------------------------------------------------------
 * GET ALL ADDRESSES (firebaseUID + email preferred)
 * @route GET /api/addresses/list/:firebaseUID
 * ---------------------------------------------------------
 */
export const getAddressesByFirebaseUID = async (req, res) => {
  try {
    const { firebaseUID } = req.params;

    const addresses = await Address.find({ firebaseUID }).sort({
      isDefaultShipping: -1,
      isDefaultBilling: -1,
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      count: addresses.length,
      data: addresses,
    });
  } catch (error) {
    console.error("Error fetching addresses:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ---------------------------------------------------------
 * GET ADDRESSES BY CUSTOMER ID (optional)
 * @route GET /api/addresses/customer/:customerId
 * ---------------------------------------------------------
 */
export const getAddressesByCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;

    const addresses = await Address.find({ customerId }).sort({
      isDefaultShipping: -1,
      isDefaultBilling: -1,
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      count: addresses.length,
      data: addresses,
    });
  } catch (error) {
    console.error("Error fetching addresses by customer:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ---------------------------------------------------------
 * GET SINGLE ADDRESS
 * @route GET /api/addresses/:id
 * (Still uses Mongo _id internally — safe + recommended)
 * ---------------------------------------------------------
 */
export const getAddressById = async (req, res) => {
  try {
    const address = await Address.findById(req.params.id);

    if (!address) {
      return res
        .status(404)
        .json({ success: false, message: "Address not found" });
    }

    res.status(200).json({ success: true, data: address });
  } catch (error) {
    console.error("Error fetching address:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ---------------------------------------------------------
 * UPDATE ADDRESS
 * @route PUT /api/addresses/:id
 * ---------------------------------------------------------
 */
export const updateAddress = async (req, res) => {
  try {
    const {
      firebaseUID,
      email,
      isDefaultShipping,
      isDefaultBilling,
    } = req.body;

    // Handle new default shipping
    if (isDefaultShipping && firebaseUID && email) {
      await Address.updateMany(
        { firebaseUID, email },
        { isDefaultShipping: false }
      );
    }

    // Handle new default billing
    if (isDefaultBilling && firebaseUID && email) {
      await Address.updateMany(
        { firebaseUID, email },
        { isDefaultBilling: false }
      );
    }

    const updated = await Address.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "Address not found" });
    }

    res.status(200).json({
      success: true,
      message: "Address updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("Error updating address:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ---------------------------------------------------------
 * DELETE ADDRESS
 * @route DELETE /api/addresses/:id
 * ---------------------------------------------------------
 */
export const deleteAddress = async (req, res) => {
  try {
    const deleted = await Address.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Address not found" });
    }

    res.status(200).json({
      success: true,
      message: "Address deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting address:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
