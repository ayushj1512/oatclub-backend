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

  moveReservationToPending,
  deleteReservation,
  transferReservation,

  detectInvalidPendingOrderReservations,
  bulkDeleteInvalidPendingOrderReservations,
} from "./InventoryReservationController.js";

import {
  reserveInventoryWebhookByOrderNumber,
} from "./inventoryWebhook.js";

const router = express.Router();

/* ---------------- reservations ---------------- */

router.post("/", createReservation);
router.get("/", listReservations);
router.post("/expire-due", expireDueReservations);

/* ---------------- inventory actions ---------------- */

router.post("/reconcile", reconcileReservations);
router.post("/add-stock", addInventoryAndReconcile);
router.post("/rto-restock", restockFromRTO);
router.post(
  "/cancel-order/:orderId",
  cancelReservationsByOrder
);

/* ---------------- repair ---------------- */

router.get(
  "/repair/pending-orders",
  detectInvalidPendingOrderReservations
);

router.delete(
  "/repair/pending-orders",
  bulkDeleteInvalidPendingOrderReservations
);

/* ---------------- webhooks ---------------- */

router.post(
  "/webhook/reserve-order/:orderNumber",
  reserveInventoryWebhookByOrderNumber
);

router.post(
  "/webhook/reserve-order",
  reserveInventoryWebhookByOrderNumber
);

/* ---------------- single reservation ---------------- */

router.get("/:id", getReservation);

router.post("/:id/release", releaseReservation);
router.post("/:id/consume", consumeReservation);
router.post("/:id/expire", expireReservation);

router.post(
  "/:id/move-to-pending",
  moveReservationToPending
);

router.post("/:id/transfer", transferReservation);

router.delete("/:id", deleteReservation);

export default router;
