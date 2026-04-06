import express from "express";
import {
  bookWithShiprocket,
  createReversePickup,
  getShiprocketTokenApi,
  syncShiprocketTrackingFlex,
  checkShiprocketServiceabilityApi,
} from "./shipping.controller.js";
import { shiprocketWebhook } from "./shiprocket.webhook.js";

const router = express.Router();

/**
 * BOOK SHIPMENT
 * POST /api/orders/:id/ship
 */
router.post("/orders/:id/ship", bookWithShiprocket);

/**
 * CHECK SHIPROCKET SERVICEABILITY
 * GET /api/shiprocket/serviceability?pickupPincode=110019&deliveryPincode=400001&weight=0.5&cod=1
 */
router.get("/shiprocket/serviceability", checkShiprocketServiceabilityApi);

/**
 * SHIPROCKET TOKEN
 * GET /api/shiprocket/token
 */
router.get("/shiprocket/token", getShiprocketTokenApi);

/**
 * SHIPROCKET WEBHOOK
 * POST /api/shiprocket/webhook
 */
router.post("/shiprocket/webhook", shiprocketWebhook);
router.post("/1bfc4cf60e6c2cc8/1bfc4cf60e6c2cc8", shiprocketWebhook);

/**
 * REVERSE PICKUP (RMA)
 * POST /api/shiprocket/reverse/:orderId/:rmaNumber
 */
router.post("/shiprocket/reverse/:orderId/:rmaNumber", createReversePickup);

/**
 * TRACKING SYNC
 * - by orderId:      /api/orders/:id/tracking/sync
 * - by orderNumber:  /api/orders/tracking/sync?orderNumber=MIRAY-000271
 */
router.get("/orders/:id/tracking/sync", syncShiprocketTrackingFlex);
router.get("/orders/tracking/sync", syncShiprocketTrackingFlex);

export default router;