import express from "express";
import {
  bulkSyncShipments,
  createShipmentFromOrder,
  getShipmentById,
  getShipmentByOrderNumber,
  listShipments,
  trackShipment,
} from "./bluedart.controller.js";

const router = express.Router();

router.post("/shipments/create-from-order", createShipmentFromOrder);

router.get("/shipments", listShipments);
router.get("/shipments/:id", getShipmentById);
router.get("/shipments/order/:orderNumber", getShipmentByOrderNumber);

router.post("/shipments/:id/track", trackShipment);
router.post("/shipments/bulk-sync", bulkSyncShipments);

export default router;