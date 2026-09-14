import express from "express";
import {
  bookWithShiprocket,
  createReversePickup,
  syncReversePickup,
  syncShiprocketTrackingFlex,
  checkShiprocketServiceabilityApi,
  getShiprocketNdrListController,
  getShiprocketNdrController,
  submitShiprocketNdrActionController,
  getShiprocketCustomerNdrOrderController,
  submitShiprocketCustomerNdrActionController,
} from "./shipping.controller.js";
import { shiprocketWebhook } from "./shiprocket.webhook.js";

const router = express.Router();

/* Shipment */
router.post("/orders/:id/ship", bookWithShiprocket);
router.get(
  "/shiprocket/serviceability",
  checkShiprocketServiceabilityApi,
);

/* Webhook */
router.post(
  "/1bfc4cf60e6c2cc8/1bfc4cf60e6c2cc8",
  shiprocketWebhook,
);
router.post("/shiprocket/webhook", shiprocketWebhook);

/* Reverse pickup */
router.post(
  "/shiprocket/return/:orderId/:rmaNumber",
  createReversePickup,
);
router.post(
  "/return/:orderId/:rmaNumber/sync",
  syncReversePickup,
);
router.post(
  "/shiprocket/return/:orderId/:rmaNumber/sync",
  syncReversePickup,
);

/* Tracking */
router.get(
  "/orders/:id/tracking/sync",
  syncShiprocketTrackingFlex,
);
router.get(
  "/orders/tracking/sync",
  syncShiprocketTrackingFlex,
);

/* NDR */
router.get(
  "/shiprocket/ndr/orders/sync",
  getShiprocketNdrListController,
);

router.get(
  "/shiprocket/ndr/customer/:orderNumber",
  getShiprocketCustomerNdrOrderController,
);

router.post(
  "/shiprocket/ndr/customer/:orderNumber/action",
  submitShiprocketCustomerNdrActionController,
);


router.get(
  "/shiprocket/ndr/:awb/status",
  getShiprocketNdrController,
);
router.post(
  "/shiprocket/ndr/:awb/action",
  submitShiprocketNdrActionController,
);

export default router;
