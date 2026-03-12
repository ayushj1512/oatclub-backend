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
   SHIPMENT MANAGEMENT
========================================================= */

router.post("/shipments/create-from-order", createShipmentFromOrder);

router.get("/shipments", listShipments);
router.get("/shipments/:id", getShipmentById);
router.get("/shipments/order/:orderNumber", getShipmentByOrderNumber);

router.post("/shipments/:id/track", trackShipment);
router.post("/shipments/bulk-sync", bulkSyncShipments);

/* =========================================================
   ESHIPZ / BLUEDART ORDERS API
========================================================= */

/* fetch orders list from eshipz */
router.get("/orders-api", listBlueDartOrdersFromApi);

/* fetch single order by sales channel order id */
router.get(
  "/orders-api/:salesChannelOrderId",
  getBlueDartOrderBySalesChannelId
);

/* =========================================================
   EDD PREDICTION
========================================================= */

router.post("/edd-prediction", getBlueDartEddPrediction);

export default router;