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
} from "../controller/orderController.js";

const router = express.Router();

router.post("/", createOrder);
router.get("/", getAllOrders);
router.get("/analytics/summary", getOrderAnalytics);
router.get("/customer/:customerId", getOrdersByCustomer);

// ✅ MUST be above "/:id"
router.get("/by-number/:orderNumber", getOrderByOrderNumber);

router.get("/:id", getOrderById);

router.put("/:id", updateOrder);
router.patch("/:id/status", updateOrderStatus);
router.patch("/:id/tracking", updateTracking);
router.delete("/:id", deleteOrder);

export default router;
