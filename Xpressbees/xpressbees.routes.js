// Xpressbees/xpressbees.routes.js

import { Router } from "express";
import {
  createXpressbeesShipmentController,
  syncXpressbeesTrackingController,
  trackXpressbeesByAwbController,
  manifestXpressbeesController,
  cancelXpressbeesController,
} from "./xpressbees.controller.js";

// 🔒 plug your admin auth middleware here
// import { requireAdmin } from "../middlewares/requireAdmin.js";

const router = Router();

// router.use(requireAdmin); // uncomment when you wire your admin auth

router.post("/:orderId/create", createXpressbeesShipmentController);
router.post("/:orderId/sync", syncXpressbeesTrackingController);
router.get("/track/:awb", trackXpressbeesByAwbController);

router.post("/manifest", manifestXpressbeesController);
router.post("/cancel/:awb", cancelXpressbeesController);

export default router;
