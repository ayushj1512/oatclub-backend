import express from "express";

/* ===========================
   ORDER CONTROLLER (Orders)
=========================== */
import {
  createOrder,
  getAllOrders,
  getOrderById,
  getOrdersByCustomer,
  updateOrder,
  updateOrderStatus,
  updateTracking,
  getOrderAnalytics,
  getOrderByOrderNumber,
  cancelOrder,
  confirmOrder, // ✅ NEW
} from "./orderController.js";

/* ===========================
   RMA CONTROLLER (RMA Only)
=========================== */
import {
  createRma,
  updateRma,
  getRmasByOrder,
  getRmaByNumber,
  getAllRmasAdmin, // ✅ NEW
} from "./orderRmaController.js";

/* ===========================
   ✅ PRODUCTION CONTROLLER (Production Flow)
=========================== */
import {
  getProductionQueue,
  getProductionSummary,
  markOrderShippedFromProduction,
} from "./order.production.controller.js"; // ✅ NEW FILE

/* ===========================
   SHIPROCKET
=========================== */
import { bookWithShiprocket } from "../shiprocket/shipping.controller.js";

const router = express.Router();

/* ============================================================
   ORDERS (Collection)
============================================================ */

// Create order
router.post("/", createOrder);

// Admin: all orders (supports query filters)
router.get("/", getAllOrders);

// Analytics summary
router.get("/analytics/summary", getOrderAnalytics);

/* ============================================================
   ✅ PRODUCTION ROUTES (CONFIRMED ONLY)
============================================================ */

// ✅ Production Summary
router.get("/production/summary", getProductionSummary);

// ✅ Production Queue (default = confirmed + processing)
router.get("/production/queue", getProductionQueue);

// ✅ Production complete -> mark shipped
router.post("/production/:id/shipped", markOrderShippedFromProduction);

// Customer orders
router.get("/customer/:customerId", getOrdersByCustomer);

// Lookup by orderNumber (⚠️ keep above "/:id")
router.get("/by-number/:orderNumber", getOrderByOrderNumber);

/* ============================================================
   ORDER ACTIONS (Ship / Cancel / Confirm)
============================================================ */

// Book shipment
router.post("/:id/ship", bookWithShiprocket);

// Cancel order
router.post("/:id/cancel", cancelOrder);

// ✅ Confirm order (Admin / COD confirm)
router.post("/:id/confirm", confirmOrder);

/* ============================================================
   RMA (Return / Exchange)
============================================================ */

// ✅ ADMIN: Get all RMAs (global list)
router.get("/rma", getAllRmasAdmin);

// Create RMA (return / exchange)
router.post("/:id/rma", createRma);

// Get all RMAs of an order
router.get("/:id/rma", getRmasByOrder);

// Get single RMA by number
router.get("/:id/rma/:rmaNumber", getRmaByNumber);

// Admin update RMA
router.patch("/:id/rma/:rmaNumber", updateRma);

/* ============================================================
   ORDER BY ID (Keep at bottom)
============================================================ */

router.get("/:id", getOrderById);
router.put("/:id", updateOrder);
router.patch("/:id/status", updateOrderStatus);
router.patch("/:id/tracking", updateTracking);

export default router;
