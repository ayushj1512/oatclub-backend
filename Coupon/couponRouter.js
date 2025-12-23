import express from "express";
import {
  createCoupon,
  getAllCoupons,
  getCouponByIdOrCode,
  updateCoupon,
  deleteCoupon,
  applyCoupon,   // NEW
} from "../Coupon/couponController.js";

const router = express.Router();

/**
 * @route   POST /api/coupons
 * @desc    Create a new coupon
 * @access  Private (Admin)
 */
router.post("/", createCoupon);

/**
 * @route   GET /api/coupons
 * @desc    Get all coupons
 * @access  Private (Admin)
 */
router.get("/", getAllCoupons);

/**
 * @route   GET /api/coupons/:idOrCode
 * @desc    Get a coupon by ID or CODE
 * @access  Public
 */
router.get("/:idOrCode", getCouponByIdOrCode);

/**
 * @route   POST /api/coupons/apply
 * @desc    Apply a coupon for a user
 * @access  Private (Customer)
 */
router.post("/apply", applyCoupon); // 🔥 NEW — IMPORTANT FOR VALIDATION

/**
 * @route   PUT /api/coupons/:id
 * @desc    Update a coupon
 * @access  Private (Admin)
 */
router.put("/:id", updateCoupon);

/**
 * @route   DELETE /api/coupons/:id
 * @desc    Delete a coupon
 * @access  Private (Admin)
 */
router.delete("/:id", deleteCoupon);

export default router;
