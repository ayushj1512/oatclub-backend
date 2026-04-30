import express from "express";
import {
  createOrderRefund,
  getOrderRefunds,
  getRefundDashboard,
  getRefundById,
  getRefundsByOrder,
  updateOrderRefund,
  approveOrderRefund,
  markRefundProcessing,
  markManualRefundProcessed,
  markRefundFailed,
  cancelOrderRefund,
  addRefundProof,
} from "./orderRefundController.js";

// import { protectAdmin } from "../../middleware/adminAuthMiddleware.js";

const router = express.Router();

// ✅ Admin only
// router.use(protectAdmin);

// Dashboard
router.get("/dashboard", getRefundDashboard);

// List + filters + pagination
router.get("/", getOrderRefunds);

// Order specific refunds + filters + pagination
router.get("/order/:orderId", getRefundsByOrder);

// Single refund
router.get("/:id", getRefundById);

// Create refund request
router.post("/", createOrderRefund);

// Update refund details
router.patch("/:id", updateOrderRefund);

// Status actions
router.patch("/:id/approve", approveOrderRefund);
router.patch("/:id/processing", markRefundProcessing);
router.patch("/:id/manual-processed", markManualRefundProcessed);
router.patch("/:id/failed", markRefundFailed);
router.patch("/:id/cancel", cancelOrderRefund);

// Proof image/link
router.post("/:id/proofs", addRefundProof);

export default router;