import express from "express";

import {
  serviceabilityController,
  createShipmentController,
  updateShipmentController,
  cancelShipmentController,
  trackingController,
  bulkTrackingController,
  referenceTrackingController,
  labelController,
  bulkLabelController,
  documentController,
  waybillController,
  warehouseController,
  updateWarehouseController,
  pickupController,
  syncAllDelhiveryTrackingController,
} from "./controller.js";

import {
  delhiveryWebhook,
} from "./webhook.js";

const router =
  express.Router();

// Serviceability
router.get(
  "/serviceability/:pincode",
  serviceabilityController,
);

// Shipment
router.post(
  "/shipments",
  createShipmentController,
);

router.patch(
  "/shipments/:waybill",
  updateShipmentController,
);

router.post(
  "/shipments/:waybill/cancel",
  cancelShipmentController,
);

// Tracking
router.get(
  "/tracking/:waybill",
  trackingController,
);

router.get(
  "/tracking/reference/:referenceId",
  referenceTrackingController,
);

router.post(
  "/tracking/bulk",
  bulkTrackingController,
);

router.post(
  "/tracking/sync-all",
  syncAllDelhiveryTrackingController,
);

// Labels
router.get(
  "/label/:waybill",
  labelController,
);

router.post(
  "/labels/bulk",
  bulkLabelController,
);

// Document
router.get(
  "/document/:waybill",
  documentController,
);

// Waybill
router.get(
  "/waybills",
  waybillController,
);

// Warehouse
router.post(
  "/warehouse",
  warehouseController,
);

router.patch(
  "/warehouse",
  updateWarehouseController,
);

// Pickup
router.post(
  "/pickup",
  pickupController,
);

// Webhook
router.post(
  "/webhook",
  delhiveryWebhook,
);

export default router;
