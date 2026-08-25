import express from "express";
import {
  bookWithShiprocket,
  createReversePickup,
  syncShiprocketTrackingFlex,
  checkShiprocketServiceabilityApi,
  syncReversePickup,
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
   SHIPROCKET WEBHOOK
   Docs suggest avoiding obvious words in webhook URL,
   so keep secret route as primary + old route as fallback.
============================================================ */
router.post("/1bfc4cf60e6c2cc8/1bfc4cf60e6c2cc8", shiprocketWebhook);

// optional fallback for local/manual testing
router.post("/shiprocket/webhook", shiprocketWebhook);

/* ============================================================
   REVERSE PICKUP (RMA)
============================================================ */

router.post(
  "/shiprocket/return/:orderId/:rmaNumber",
  createReversePickup
);

router.post(
  "/return/:orderId/:rmaNumber/sync",
  syncReversePickup
);

router.post(
  "/shiprocket/return/:orderId/:rmaNumber/sync",
  syncReversePickup
);
/* ============================================================
   TRACKING SYNC
============================================================ */
router.get("/orders/:id/tracking/sync", syncShiprocketTrackingFlex);
router.get("/orders/tracking/sync", syncShiprocketTrackingFlex);

export default router;
