import express from "express";
import {
  bulkSyncShipments,
  createShipmentFromOrder,
  getShipmentById,
  getShipmentByOrderNumber,
  listShipments,
  trackShipment,
  listBlueDartOrdersFromApi,
  getBlueDartOrderBySalesChannelId,
  getBlueDartEddPrediction,
} from "./bluedart.controller.js";

const router = express.Router();

/* =========================================================
   ESHIPZ / BLUEDART SHIPMENT MANAGEMENT
   Partner: eshipz
   Carrier: BlueDart
========================================================= */

// Create shipment from local order
router.post("/shipments/create-from-order", createShipmentFromOrder);
router.post("/eshipz/shipments/create-from-order", createShipmentFromOrder);

// List local shipment records
router.get("/shipments", listShipments);
router.get("/eshipz/shipments", listShipments);

// Bulk sync local shipments
router.post("/shipments/bulk-sync", bulkSyncShipments);
router.post("/eshipz/shipments/bulk-sync", bulkSyncShipments);

/* =========================================================
   TRACK / SYNC SHIPMENT
========================================================= */

// Track/sync one local shipment by Mongo shipment id
router.post("/shipments/:id/track", trackShipment);
router.post("/eshipz/shipments/:id/track", trackShipment);

// Optional clean aliases
router.post("/track/:id", trackShipment);
router.post("/eshipz/track/:id", trackShipment);

/* =========================================================
   GET LOCAL SHIPMENT DETAILS
   Keep dynamic routes after specific routes
========================================================= */

// Get local shipment by order number
router.get("/shipments/order/:orderNumber", getShipmentByOrderNumber);
router.get("/eshipz/shipments/order/:orderNumber", getShipmentByOrderNumber);

// Get local shipment by Mongo id
router.get("/shipments/:id", getShipmentById);
router.get("/eshipz/shipments/:id", getShipmentById);

/* =========================================================
   ESHIPZ ORDERS API
========================================================= */

// Fetch orders list from Eshipz
router.get("/orders-api", listBlueDartOrdersFromApi);
router.get("/eshipz/orders-api", listBlueDartOrdersFromApi);

// Fetch single order by sales channel order id
router.get(
  "/orders-api/:salesChannelOrderId",
  getBlueDartOrderBySalesChannelId
);

router.get(
  "/eshipz/orders-api/:salesChannelOrderId",
  getBlueDartOrderBySalesChannelId
);

/* =========================================================
   ESHIPZ EDD PREDICTION
========================================================= */

router.post("/edd-prediction", getBlueDartEddPrediction);
router.post("/eshipz/edd-prediction", getBlueDartEddPrediction);

export default router;