import express from "express";

import {
  getAllRefunds,
  getRefundById,
  getRefundPendingOrders,
  createRefundFromOrder,
  processRazorpayRefund,
  fetchRazorpayRefundStatus,
  createManualRefundFromOrder,
  markManualRefundProcessed,
  markManualRefundFailed,
  addRefundProof,
} from "./orderRefundController.js";

const router = express.Router();

/* =========================================================
   LIST / QUEUE
========================================================= */

router.get("/", getAllRefunds);
router.get("/pending-orders", getRefundPendingOrders);

/* =========================================================
   CREATE REFUNDS FROM ORDER
========================================================= */

router.post("/razorpay/order/:orderId/create", createRefundFromOrder);
router.post("/manual/order/:orderId/create", createManualRefundFromOrder);

/* =========================================================
   RAZORPAY ACTIONS
========================================================= */

router.post("/razorpay/:refundId/process", processRazorpayRefund);
router.get("/razorpay/:refundId/status", fetchRazorpayRefundStatus);

/* =========================================================
   MANUAL ACTIONS
========================================================= */

router.patch("/:refundId/manual-processed", markManualRefundProcessed);
router.patch("/:refundId/manual-failed", markManualRefundFailed);

/* =========================================================
   PROOFS
========================================================= */

router.post("/:id/proofs", addRefundProof);

/* =========================================================
   SINGLE REFUND
   keep dynamic route last
========================================================= */

router.get("/:refundId", getRefundById);

export default router;