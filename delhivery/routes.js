import express from "express";

import {
  serviceabilityController,
  createShipmentController,
  trackingController,
  labelController,
  warehouseController,
  pickupController,
} from "./controller.js";

import { delhiveryWebhook } from "./webhook.js";

const router = express.Router();

router.get("/serviceability/:pincode", serviceabilityController);
router.post("/shipments", createShipmentController);
router.get("/tracking/:waybill", trackingController);
router.get("/label/:waybill", labelController);
router.post("/warehouse", warehouseController);
router.post("/pickup", pickupController);
router.post("/webhook", delhiveryWebhook);

export default router;
