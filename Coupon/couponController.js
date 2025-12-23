import Coupon from "./Coupon.js";
import mongoose from "mongoose";

/**
 * @desc Create a new coupon
 * @route POST /api/coupons
 * @access Private (Admin)
 */
export const createCoupon = async (req, res) => {
  try {
    const {
      code,
      type,
      description,
      discountType,
      discountValue,
      minPurchase,
      maxDiscount,
      influencerId,
      issuedBy,
      validFrom,
      validTill,
      usageLimit,
      usageLimitPerCustomer, // NEW
      isActive,
    } = req.body;

    // Check if code already exists
    const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
    if (existingCoupon) {
      return res.status(400).json({ message: "Coupon code already exists." });
    }

    const coupon = await Coupon.create({
      code,
      type,
      description,
      discountType,
      discountValue,
      minPurchase,
      maxDiscount,
      influencerId,
      issuedBy,
      validFrom,
      validTill,
      usageLimit,
      usageLimitPerCustomer, // NEW
      isActive,
      usedBy: [], // NEW — Track customer usage list
    });

    res.status(201).json({
      message: "Coupon created successfully",
      data: coupon,
    });
  } catch (error) {
    console.error("Error creating coupon:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get all coupons (with filters)
 * @route GET /api/coupons
 * @access Private (Admin)
 */
export const getAllCoupons = async (req, res) => {
  try {
    const { type, isActive, influencerId } = req.query;

    const filter = {};
    if (type) filter.type = type;
    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (influencerId) filter.influencerId = influencerId;

    const coupons = await Coupon.find(filter)
      .sort({ createdAt: -1 })
      .populate("influencerId", "name email")
      .populate("issuedBy", "username email");

    res.status(200).json({ count: coupons.length, data: coupons });
  } catch (error) {
    console.error("Error fetching coupons:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get a single coupon by ID or code
 * @route GET /api/coupons/:idOrCode
 * @access Public
 */
export const getCouponByIdOrCode = async (req, res) => {
  try {
    const { idOrCode } = req.params;

    let coupon;
    if (mongoose.Types.ObjectId.isValid(idOrCode)) {
      coupon = await Coupon.findById(idOrCode);
    } else {
      coupon = await Coupon.findOne({ code: idOrCode.toUpperCase() });
    }

    if (!coupon) {
      return res.status(404).json({ message: "Coupon not found" });
    }

    res.status(200).json(coupon);
  } catch (error) {
    console.error("Error fetching coupon:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Update a coupon
 * @route PUT /api/coupons/:id
 * @access Private (Admin)
 */
export const updateCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const coupon = await Coupon.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (!coupon) {
      return res.status(404).json({ message: "Coupon not found" });
    }

    // Auto-deactivate if expired
    if (coupon.validTill < new Date()) {
      coupon.isActive = false;
      await coupon.save();
    }

    res.status(200).json({
      message: "Coupon updated successfully",
      data: coupon,
    });
  } catch (error) {
    console.error("Error updating coupon:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Delete a coupon
 * @route DELETE /api/coupons/:id
 * @access Private (Admin)
 */
export const deleteCoupon = async (req, res) => {
  try {
    const { id } = req.params;

    const coupon = await Coupon.findByIdAndDelete(id);

    if (!coupon) {
      return res.status(404).json({ message: "Coupon not found" });
    }

    res.status(200).json({ message: "Coupon deleted successfully" });
  } catch (error) {
    console.error("Error deleting coupon:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};


/**
 * @desc Apply coupon for a customer
 * @route POST /api/coupons/apply
 * @access Private (Customer)
 */
export const applyCoupon = async (req, res) => {
  try {
    const { code, customerId, cartTotal } = req.body;

    if (!code || !customerId || !cartTotal) {
      return res.status(400).json({
        message: "code, customerId and cartTotal are required.",
      });
    }

    const coupon = await Coupon.findOne({ code: code.toUpperCase() });

    if (!coupon) {
      return res.status(404).json({ message: "Invalid coupon code." });
    }

    // Check active
    if (!coupon.isActive) {
      return res.status(400).json({ message: "Coupon is not active." });
    }

    // Check expired
    if (new Date() > coupon.validTill) {
      return res.status(400).json({ message: "Coupon has expired." });
    }

    // Minimum purchase
    if (cartTotal < coupon.minPurchase) {
      return res.status(400).json({
        message: `Minimum purchase required is ₹${coupon.minPurchase}`,
      });
    }

    // GLOBAL usage limit
    if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({
        message: "Coupon usage limit has been reached.",
      });
    }

    // PER-CUSTOMER usage limit (default = 1)
    if (coupon.usedBy.includes(customerId)) {
      return res.status(400).json({
        message: "You have already used this coupon.",
      });
    }

    // Calculate discount
    let discountAmount = 0;

    if (coupon.discountType === "percentage") {
      discountAmount = (cartTotal * coupon.discountValue) / 100;

      if (coupon.maxDiscount > 0) {
        discountAmount = Math.min(discountAmount, coupon.maxDiscount);
      }
    } else if (coupon.discountType === "flat") {
      discountAmount = coupon.discountValue;
    }

    // Ensure discount is not negative
    if (discountAmount <= 0) {
      return res.status(400).json({
        message: "Invalid discount calculation.",
      });
    }

    // Apply usage tracking
    coupon.usedBy.push(customerId);
    coupon.usedCount += 1;

    await coupon.save();

    res.status(200).json({
      message: "Coupon applied successfully",
      discount: discountAmount,
      finalTotal: cartTotal - discountAmount,
    });
  } catch (error) {
    console.error("Error applying coupon:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};


