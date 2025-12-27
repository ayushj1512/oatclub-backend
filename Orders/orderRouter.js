import express from "express";
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

  // RMA
  createRma,
  updateRma,

  // Cancel
  cancelOrder,
} from "./orderController.js";

// 🚚 Shiprocket
import { bookWithShiprocket } from "../shiprocket/shipping.controller.js";

const router = express.Router();

/* ============================================================
   ORDERS
============================================================ */
router.post("/", createOrder);
router.get("/", getAllOrders);
router.get("/analytics/summary", getOrderAnalytics);
router.get("/customer/:customerId", getOrdersByCustomer);

// ⚠️ MUST be above "/:id"
router.get("/by-number/:orderNumber", getOrderByOrderNumber);

/* ============================================================
   ORDER ACTIONS
============================================================ */

// 🚚 Book shipment with Shiprocket
// POST /api/orders/:id/ship
router.post("/:id/ship", bookWithShiprocket);

// ❌ Cancel order
// POST /api/orders/:id/cancel
router.post("/:id/cancel", cancelOrder);

/* ============================================================
   RMA (Return / Exchange)
============================================================ */

// Create RMA
// POST /api/orders/:id/rma
router.post("/:id/rma", createRma);

// Update RMA
// PATCH /api/orders/:id/rma/:rmaNumber
router.patch("/:id/rma/:rmaNumber", updateRma);

/* ============================================================
   ORDER BY ID
============================================================ */
router.get("/:id", getOrderById);
router.put("/:id", updateOrder);
router.patch("/:id/status", updateOrderStatus);
router.patch("/:id/tracking", updateTracking);

// ❌ deleteOrder intentionally removed (soft lifecycle only)

export default router;
