import express from "express";
import {
  bookWithShiprocket,
  createReversePickup,
  syncShiprocketTrackingFlex,
  checkShiprocketServiceabilityApi,
} from "./shipping.controller.js";
import { shiprocketWebhook } from "./shiprocket.webhook.js";

const router = express.Router();

/* ============================================================
   SHIPMENT BOOKING
============================================================ */
router.post("/orders/:id/ship", bookWithShiprocket);

/* ============================================================
   SERVICEABILITY
============================================================ */
router.get("/shiprocket/serviceability", checkShiprocketServiceabilityApi);

/* ============================================================
   WEBHOOK (keep both)
============================================================ */
router.post("/shiprocket/webhook", shiprocketWebhook);
router.post("/1bfc4cf60e6c2cc8/1bfc4cf60e6c2cc8", shiprocketWebhook);

/* ============================================================
   REVERSE PICKUP (RMA)
============================================================ */
router.post("/shiprocket/reverse/:orderId/:rmaNumber", createReversePickup);

/* ============================================================
   TRACKING SYNC
============================================================ */
router.get("/orders/:id/tracking/sync", syncShiprocketTrackingFlex);
router.get("/orders/tracking/sync", syncShiprocketTrackingFlex);

export default router;