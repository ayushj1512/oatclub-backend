  import express from "express";
  import {
    createCoupon,
    getAllCoupons,
    getCouponByIdOrCode,
    updateCoupon,
    deleteCoupon,
    applyCoupon,
    redeemCoupon, // ✅ NEW
  } from "../Coupon/couponController.js";

  const router = express.Router();

  // Admin
  router.post("/", createCoupon);
  router.get("/", getAllCoupons);

  // ✅ IMPORTANT: keep these BEFORE "/:idOrCode"
  router.post("/apply", applyCoupon);
  router.post("/redeem", redeemCoupon);

  // Public
  router.get("/:idOrCode", getCouponByIdOrCode);

  // Admin
  router.put("/:id", updateCoupon);
  router.delete("/:id", deleteCoupon);

  export default router;
