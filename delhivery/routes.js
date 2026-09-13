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
  createReversePickupController,
  syncReversePickupController,
  getNdrStatusController,
  updateNdrController,
  getDelhiveryNdrOrdersController,
  getCustomerNdrOrderController,
  submitCustomerNdrActionController,
} from "./controller.js";

import {
  delhiveryWebhook,
} from "./webhook.js";

const router = express.Router();

// Serviceability
router.get(
  "/serviceability/:pincode",
  serviceabilityController,
);

// Shipments
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

// Reverse pickup
router.post(
  "/reverse/:orderId/:rmaNumber",
  createReversePickupController,
);

router.post(
  "/reverse/:orderId/:rmaNumber/sync",
  syncReversePickupController,
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

// Waybills
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

// Admin NDR
router.get(
  "/ndr/orders/sync",
  getDelhiveryNdrOrdersController,
);

router.post(
  "/ndr/:waybill/action",
  updateNdrController,
);

router.get(
  "/ndr/status/:requestId",
  getNdrStatusController,
);

// Customer NDR
router.get(
  "/ndr/customer/:token",
  getCustomerNdrOrderController,
);

router.post(
  "/ndr/customer/:token/action",
  submitCustomerNdrActionController,
);

export default router;
