import express from "express";
import {
  createCoupon,
  getAllCoupons,
  getCouponByIdOrCode,
  updateCoupon,
  deleteCoupon,
} from "../controllers/couponController.js";

const router = express.Router();

/**
 * @route   POST /api/coupons
 * @desc    Create a new coupon
 * @access  Private (Admin)
 */
router.post("/", createCoupon);

/**
 * @route   GET /api/coupons
 * @desc    Get all coupons (optional filters by type, influencer, isActive)
 * @access  Private (Admin)
 */
router.get("/", getAllCoupons);

/**
 * @route   GET /api/coupons/:idOrCode
 * @desc    Get a coupon by its ID or CODE
 * @access  Public
 */
router.get("/:idOrCode", getCouponByIdOrCode);

/**
 * @route   PUT /api/coupons/:id
 * @desc    Update a coupon by ID
 * @access  Private (Admin)
 */
router.put("/:id", updateCoupon);

/**
 * @route   DELETE /api/coupons/:id
 * @desc    Delete a coupon by ID
 * @access  Private (Admin)
 */
router.delete("/:id", deleteCoupon);

export default router;
