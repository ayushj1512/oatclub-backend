import express from "express";
import {
  createReservation,
  releaseReservation,
  consumeReservation,
  expireReservation,
  expireDueReservations,
  listReservations,
  getReservation,
  addInventoryAndReconcile,
  cancelReservationsByOrder,
  restockFromRTO,
  reconcileReservations,
} from "./InventoryReservationController.js";

import { reserveInventoryWebhookByOrderNumber } from "./inventoryWebhook.js";

const router = express.Router();

/* ---------------------------------------------------
   reservation routes
--------------------------------------------------- */
router.post("/", createReservation);
router.get("/", listReservations);
router.post("/expire-due", expireDueReservations);

/* ---------------------------------------------------
   inventory action routes
--------------------------------------------------- */
router.post("/reconcile", reconcileReservations);
router.post("/add-stock", addInventoryAndReconcile);
router.post("/rto-restock", restockFromRTO);
router.post("/cancel-order/:orderId", cancelReservationsByOrder);

/* ---------------------------------------------------
   webhook routes
--------------------------------------------------- */
router.post("/webhook/reserve-order/:orderNumber", reserveInventoryWebhookByOrderNumber);
router.post("/webhook/reserve-order", reserveInventoryWebhookByOrderNumber);

/* ---------------------------------------------------
   single reservation routes
--------------------------------------------------- */
router.get("/:id", getReservation);
router.post("/:id/release", releaseReservation);
router.post("/:id/consume", consumeReservation);
router.post("/:id/expire", expireReservation);

export default router;