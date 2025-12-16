import express from "express";
import {
  createOrder,
  getAllOrders,
  getOrderById,
  getOrdersByCustomer,
  updateOrder,
  updateOrderStatus,
  updateTracking,
  deleteOrder,
  getOrderAnalytics,
  getOrderByOrderNumber,
  // ✅ RMA (embedded in Order)
  createRma,
  updateRma,
} from "../controller/orderController.js";

const router = express.Router();

// ------------------- Orders -------------------
router.post("/", createOrder);
router.get("/", getAllOrders);
router.get("/analytics/summary", getOrderAnalytics);
router.get("/customer/:customerId", getOrdersByCustomer);

// ✅ MUST be above "/:id"
router.get("/by-number/:orderNumber", getOrderByOrderNumber);

// ------------------- RMA (embedded in Order) -------------------
// Create RMA for an order (policy enforced in controller: 7 days, exchange fee)
// POST /api/orders/:id/rma
router.post("/:id/rma", createRma);

// Update RMA by rmaNumber (supports updating fee.status too)
// PATCH /api/orders/:id/rma/:rmaNumber
router.patch("/:id/rma/:rmaNumber", updateRma);

// ------------------- Order by id -------------------
router.get("/:id", getOrderById);

router.put("/:id", updateOrder);
router.patch("/:id/status", updateOrderStatus);
router.patch("/:id/tracking", updateTracking);
router.delete("/:id", deleteOrder);

export default router;
