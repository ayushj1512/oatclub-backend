import express from "express";

import {
  protectAffiliate,

  createAffiliate,
  loginAffiliate,

  getAffiliateProfile,
  getAllAffiliates,
  getAffiliateById,
  getAffiliateOrders,
  getAffiliateDashboard,

  updateAffiliate,
  updateAffiliateStatus,
  changeAffiliatePassword,
  recordAffiliatePayout,

  deleteAffiliate,
} from "./AffiliateController.js";

const router = express.Router();

/* ================================================================
   AUTH
================================================================ */

router.post("/login", loginAffiliate);

/* ================================================================
   INFLUENCER PORTAL
================================================================ */

router.get(
  "/profile",
  protectAffiliate,
  getAffiliateProfile
);

router.get(
  "/profile/dashboard",
  protectAffiliate,
  getAffiliateDashboard
);

router.get(
  "/profile/orders",
  protectAffiliate,
  getAffiliateOrders
);

router.patch(
  "/profile/password",
  protectAffiliate,
  changeAffiliatePassword
);

/* ================================================================
   ADMIN
   Add your protectAdmin middleware here.
================================================================ */

router.post("/", createAffiliate);

router.get("/", getAllAffiliates);

router.get("/:id/dashboard", getAffiliateDashboard);

router.get("/:id/orders", getAffiliateOrders);

router.post("/:id/payouts", recordAffiliatePayout);

router.patch(
  "/:id/status",
  updateAffiliateStatus
);

router.patch(
  "/:id/password",
  changeAffiliatePassword
);

router.get("/:id", getAffiliateById);

router.put("/:id", updateAffiliate);
router.patch("/:id", updateAffiliate);

router.delete("/:id", deleteAffiliate);

export default router;