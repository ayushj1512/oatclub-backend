import express from "express";
import {
  createCoupon,
  getAllCoupons,
  getCouponByIdOrCode,
  updateCoupon,
  deleteCoupon,
  applyCoupon,
  autoApplyCoupon,
  redeemCoupon,
  getAvailableCoupons
} from "../Coupon/couponController.js";

const router = express.Router();

/* ------------------------------------------------------------------
ADMIN COUPONS
------------------------------------------------------------------- */

router.post("/", createCoupon);
router.get("/", getAllCoupons);

/* ------------------------------------------------------------------
COUPON ACTIONS
Keep these BEFORE "/:idOrCode"
------------------------------------------------------------------- */

router.post("/apply", applyCoupon);
router.post("/auto-apply", autoApplyCoupon);
router.post("/redeem", redeemCoupon);
router.post("/available", getAvailableCoupons);
/* ------------------------------------------------------------------
PUBLIC COUPON LOOKUP
------------------------------------------------------------------- */

router.get("/:idOrCode", getCouponByIdOrCode);


/* ------------------------------------------------------------------
ADMIN SINGLE COUPON
------------------------------------------------------------------- */

router.put("/:id", updateCoupon);
router.delete("/:id", deleteCoupon);

export default router;