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

// Get local shipment by Mongo id
router.get("/shipments/:id", getShipmentById);
router.get("/eshipz/shipments/:id", getShipmentById);

// Get local shipment by order number
router.get("/shipments/order/:orderNumber", getShipmentByOrderNumber);
router.get("/eshipz/shipments/order/:orderNumber", getShipmentByOrderNumber);

// Track/sync one shipment
router.post("/shipments/:id/track", trackShipment);
router.post("/eshipz/shipments/:id/track", trackShipment);

// Bulk sync local shipments
router.post("/shipments/bulk-sync", bulkSyncShipments);
router.post("/eshipz/shipments/bulk-sync", bulkSyncShipments);

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