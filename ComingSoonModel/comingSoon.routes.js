// routes/comingSoon.routes.js
import express from "express";
import {
  getByProduct,
  subscribeNotify,
  trackEngagement,
  getAll,
  manualLaunch,
  updateThreshold,
} from "./comingSoon.controller.js";

const router = express.Router();

/* ---------- FRONTEND ---------- */
router.get("/:productId", getByProduct);
router.post("/:productId/subscribe", subscribeNotify);
router.post("/:productId/track", trackEngagement);

/* ---------- ADMIN ---------- */
router.get("/", getAll);
router.post("/:id/manual-launch", manualLaunch);
router.put("/:id/threshold", updateThreshold);

export default router;
