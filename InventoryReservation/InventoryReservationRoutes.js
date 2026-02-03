// InventoryReservation/InventoryReservationRoutes.js
import express from "express";
import {
  createReservation,
  releaseReservation,
  consumeReservation,
  expireReservation,
  expireDueReservations,
  listReservations,
  getReservation,
} from "./InventoryReservationController.js";

const router = express.Router();

/**
 * Inventory Reservations
 * Base (suggested): /api/inventory-reservations
 */

// ✅ create reservation
router.post("/", createReservation);

// ✅ list reservations (filters)
router.get("/", listReservations);

// ✅ expire due (cron/manual trigger)
router.post("/expire-due", expireDueReservations);

// ✅ get single reservation
router.get("/:id", getReservation);

// ✅ release reservation (cancel/payment failed)
router.post("/:id/release", releaseReservation);

// ✅ consume reservation (issue/ship)
router.post("/:id/consume", consumeReservation);

// ✅ expire single reservation (manual)
router.post("/:id/expire", expireReservation);

export default router;
