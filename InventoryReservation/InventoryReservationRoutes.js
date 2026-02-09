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

// ✅ NEW: orderNumber webhook controller
import {
  reserveInventoryWebhookByOrderNumber,
} from "./inventoryWebhook.js";

const router = express.Router();

/**
 * Inventory Reservations
 * Base: /api/inventory-reservations
 */

// ========================================
// STANDARD RESERVATION ROUTES
// ========================================

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


// ========================================
// 🔥 ORDER-BASED INVENTORY WEBHOOK
// ========================================

/**
 * POST /api/inventory-reservations/webhook/reserve-order/:orderNumber
 *
 * Example:
 * POST /api/inventory-reservations/webhook/reserve-order/MIRAY-000187
 *
 * Behavior:
 * - Looks up order by orderNumber
 * - Reserves inventory for available products only
 * - Skips insufficient ones
 */
router.post(
  "/webhook/reserve-order/:orderNumber",
  reserveInventoryWebhookByOrderNumber
);

export default router;
