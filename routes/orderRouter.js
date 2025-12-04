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
} from "../controller/orderController.js";

const router = express.Router();

/**
 * @route POST /api/orders
 * @desc Create a new order (Customer)
 * @access Private
 */
router.post("/", createOrder);

/**
 * @route GET /api/orders
 * @desc Get all orders (Admin)
 * @access Private/Admin
 */
router.get("/", getAllOrders);

/**
 * @route GET /api/orders/analytics/summary
 * @desc Order analytics summary for dashboard
 * @access Private/Admin
 */
router.get("/analytics/summary", getOrderAnalytics);

/**
 * @route GET /api/orders/customer/:customerId
 * @desc Get all orders for a specific customer
 * @access Private
 */
router.get("/customer/:customerId", getOrdersByCustomer);

/**
 * @route GET /api/orders/:id
 * @desc Get a single order by ID
 * @access Private/Admin
 */
router.get("/:id", getOrderById);

/**
 * @route PUT /api/orders/:id
 * @desc Update entire order (Admin only)
 * @access Private/Admin
 */
router.put("/:id", updateOrder);

/**
 * @route PATCH /api/orders/:id/status
 * @desc Update only the order status (faster, safer)
 * @access Private/Admin
 */
router.patch("/:id/status", updateOrderStatus);

/**
 * @route PATCH /api/orders/:id/tracking
 * @desc Update tracking details (courier, AWB, shippedAt)
 * @access Private/Admin
 */
router.patch("/:id/tracking", updateTracking);

/**
 * @route DELETE /api/orders/:id
 * @desc Delete an order
 * @access Private/Admin
 */
router.delete("/:id", deleteOrder);

export default router;
