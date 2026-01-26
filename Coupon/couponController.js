import Coupon from "./Coupon.js";
import mongoose from "mongoose";

/**
 * Helpers
 */
const normCode = (v) => String(v || "").trim().toUpperCase();
const normEmail = (v) => String(v || "").trim().toLowerCase();

// ✅ digits-only (matches schema normalizePhone)
const normPhone = (v) => {
  const digits = String(v || "").replace(/\D/g, "");
  return digits.length ? digits : "";
};

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(v));
const isPhone = (v) => {
  const digits = normPhone(v);
  return digits.length >= 10 && digits.length <= 15;
};

const buildCustomerKey = ({ email, phone, customerId }) => {
  // ✅ preferred: email/phone (guest)
  if (email && isEmail(email)) return `email:${normEmail(email)}`;
  if (phone && isPhone(phone)) return `phone:${normPhone(phone)}`;

  // ✅ fallback (logged-in uid etc)
  if (customerId) {
    const cid = String(customerId).trim();
    // treat literal "guest" as invalid identity (prevents global guest lock)
    if (!cid || cid.toLowerCase() === "guest") return null;
    return `id:${cid}`;
  }

  return null;
};

const calcDiscount = (coupon, cartTotal) => {
  let discount = 0;

  if (coupon.discountType === "percentage") {
    discount = (Number(cartTotal) * Number(coupon.discountValue || 0)) / 100;
    if (Number(coupon.maxDiscount) > 0) discount = Math.min(discount, Number(coupon.maxDiscount));
  } else {
    discount = Number(coupon.discountValue || 0);
  }

  discount = Math.max(0, Math.min(discount, Number(cartTotal)));
  const finalTotal = Math.max(0, Number(cartTotal) - discount);

  return { discount, finalTotal };
};

const isWithinDates = (coupon) => {
  const now = new Date();
  const vf = coupon.validFrom ? new Date(coupon.validFrom) : null;
  const vt = coupon.validTill ? new Date(coupon.validTill) : null;
  if (vf && now < vf) return false;
  if (vt && now > vt) return false;
  return true;
};

// ✅ enforce targeted coupons (email/phone)
const enforceTargets = ({ coupon, email, phone, res }) => {
  if (coupon.targetEmail) {
    if (!email || normEmail(email) !== coupon.targetEmail) {
      res.status(403).json({ message: "This coupon is not applicable for this email." });
      return false;
    }
  }

  if (coupon.targetPhone) {
    if (!phone || normPhone(phone) !== coupon.targetPhone) {
      res.status(403).json({ message: "This coupon is not applicable for this phone number." });
      return false;
    }
  }

  return true;
};

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
      visibility, // ✅ new
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
      usageLimitPerCustomer,
      isActive,
      targetEmail, // ✅ new
      targetPhone, // ✅ new
    } = req.body;

    if (!code || !validTill || !discountType || discountValue == null) {
      return res.status(400).json({ message: "Missing required coupon fields." });
    }

    const couponCode = normCode(code);

    const existingCoupon = await Coupon.findOne({ code: couponCode });
    if (existingCoupon) {
      return res.status(400).json({ message: "Coupon code already exists." });
    }

    const coupon = await Coupon.create({
      code: couponCode,
      type,
      visibility, // ✅ add
      description,
      discountType,
      discountValue,
      minPurchase,
      maxDiscount,
      influencerId: influencerId || null,
      issuedBy: issuedBy || null,
      validFrom,
      validTill,
      usageLimit,
      usageLimitPerCustomer,
      isActive,
      targetEmail: targetEmail ? normEmail(targetEmail) : null, // ✅ add
      targetPhone: targetPhone ? normPhone(targetPhone) : null, // ✅ add
      usedBy: [],
    });

    res.status(201).json({ message: "Coupon created successfully", data: coupon });
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
    const { type, isActive, influencerId, visibility } = req.query;

    const filter = {};
    if (type) filter.type = type;
    if (visibility) filter.visibility = visibility;
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
 *
 * ✅ NOTE: This blocks private coupons from being fetched publicly (prevents leaking private codes).
 * If you want admins to access private coupons via this route, protect this route with auth middleware.
 */
export const getCouponByIdOrCode = async (req, res) => {
  try {
    const { idOrCode } = req.params;

    let coupon;
    if (mongoose.Types.ObjectId.isValid(idOrCode)) {
      coupon = await Coupon.findById(idOrCode);
    } else {
      coupon = await Coupon.findOne({ code: normCode(idOrCode) });
    }

    if (!coupon) return res.status(404).json({ message: "Coupon not found" });

    // ✅ block private coupon from public fetch
    if (coupon.visibility === "private") {
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
    const updates = { ...req.body };

    if (updates.code) updates.code = normCode(updates.code);

    // ✅ normalize targets if present
    if (updates.targetEmail !== undefined) updates.targetEmail = updates.targetEmail ? normEmail(updates.targetEmail) : null;
    if (updates.targetPhone !== undefined) updates.targetPhone = updates.targetPhone ? normPhone(updates.targetPhone) : null;

    const coupon = await Coupon.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (!coupon) return res.status(404).json({ message: "Coupon not found" });

    res.status(200).json({ message: "Coupon updated successfully", data: coupon });
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
    if (!coupon) return res.status(404).json({ message: "Coupon not found" });

    res.status(200).json({ message: "Coupon deleted successfully" });
  } catch (error) {
    console.error("Error deleting coupon:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Apply coupon (VALIDATE + CALCULATE ONLY)
 *       ✅ identifies customer via email OR phone OR customerId
 *       ✅ blocks "guest" identity until email/phone provided
 *       ✅ validates targetEmail/targetPhone if present
 *       ✅ DOES NOT mark usedBy / usedCount (do that on order success)
 * @route POST /api/coupons/apply
 * @access Public/Private (Customer/Guest)
 */
export const applyCoupon = async (req, res) => {
  try {
    const { code, cartTotal, email, phone, customerId } = req.body;

    if (!code || cartTotal == null) {
      return res.status(400).json({ message: "code and cartTotal are required." });
    }

    const couponCode = normCode(code);
    const customerKey = buildCustomerKey({ email, phone, customerId });

    if (!customerKey) {
      return res.status(400).json({
        message: "Please enter email or phone number to apply coupon.",
      });
    }

    const coupon = await Coupon.findOne({ code: couponCode });
    if (!coupon) return res.status(404).json({ message: "Invalid coupon code." });

    if (!coupon.isActive) return res.status(400).json({ message: "Coupon is not active." });
    if (!isWithinDates(coupon)) return res.status(400).json({ message: "Coupon is expired or not yet active." });

    // ✅ enforce mobile/email targeting
    if (!enforceTargets({ coupon, email, phone, res })) return;

    if (Number(cartTotal) < Number(coupon.minPurchase || 0)) {
      return res.status(400).json({
        message: `Minimum purchase required is ₹${coupon.minPurchase}`,
      });
    }

    // global usage limit (0 => unlimited)
    if (Number(coupon.usageLimit) > 0 && Number(coupon.usedCount) >= Number(coupon.usageLimit)) {
      return res.status(400).json({ message: "Coupon usage limit has been reached." });
    }

    // per customer usage limit (0 => unlimited)
    const perLimit = Number(coupon.usageLimitPerCustomer ?? 1);
    if (perLimit > 0) {
      const usedTimes = (coupon.usedBy || []).filter((x) => String(x) === customerKey).length;
      if (usedTimes >= perLimit) {
        return res.status(400).json({ message: "You have already used this coupon." });
      }
    }

    const { discount, finalTotal } = calcDiscount(coupon, cartTotal);
    if (discount <= 0) return res.status(400).json({ message: "Invalid discount calculation." });

    return res.status(200).json({
      message: "Coupon applied successfully",
      discount,
      finalTotal,
      customerKey, // optional for debugging (remove if you want)
    });
  } catch (error) {
    console.error("Error applying coupon:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * ✅ Redeem coupon (MARK USED) – call this only when order/payment is successful
 * @route POST /api/coupons/redeem
 * @access Private (Order service / Customer)
 */
export const redeemCoupon = async (req, res) => {
  try {
    const { code, cartTotal, email, phone, customerId } = req.body;

    if (!code || cartTotal == null) {
      return res.status(400).json({ message: "code and cartTotal are required." });
    }

    const couponCode = normCode(code);
    const customerKey = buildCustomerKey({ email, phone, customerId });

    if (!customerKey) {
      return res.status(400).json({
        message: "Please provide email or phone number to redeem coupon.",
      });
    }

    const coupon = await Coupon.findOne({ code: couponCode });
    if (!coupon) return res.status(404).json({ message: "Invalid coupon code." });

    if (!coupon.isActive) return res.status(400).json({ message: "Coupon is not active." });
    if (!isWithinDates(coupon)) return res.status(400).json({ message: "Coupon is expired or not yet active." });

    // ✅ enforce mobile/email targeting
    if (!enforceTargets({ coupon, email, phone, res })) return;

    if (Number(cartTotal) < Number(coupon.minPurchase || 0)) {
      return res.status(400).json({
        message: `Minimum purchase required is ₹${coupon.minPurchase}`,
      });
    }

    // Re-check limits
    if (Number(coupon.usageLimit) > 0 && Number(coupon.usedCount) >= Number(coupon.usageLimit)) {
      return res.status(400).json({ message: "Coupon usage limit has been reached." });
    }

    const perLimit = Number(coupon.usageLimitPerCustomer ?? 1);
    if (perLimit > 0) {
      const usedTimes = (coupon.usedBy || []).filter((x) => String(x) === customerKey).length;
      if (usedTimes >= perLimit) {
        return res.status(400).json({ message: "You have already used this coupon." });
      }
    }

    const { discount, finalTotal } = calcDiscount(coupon, cartTotal);
    if (discount <= 0) return res.status(400).json({ message: "Invalid discount calculation." });

    // ✅ NOW mark usage
    // IMPORTANT: use $push (NOT $addToSet) because you count usage by duplicates in usedBy
    const updated = await Coupon.findOneAndUpdate(
      { code: couponCode },
      {
        $push: { usedBy: customerKey },
        $inc: { usedCount: 1 },
      },
      { new: true }
    );

    return res.status(200).json({
      message: "Coupon redeemed successfully",
      discount,
      finalTotal,
      data: updated,
    });
  } catch (error) {
    console.error("Error redeeming coupon:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
