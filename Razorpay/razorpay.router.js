import express from "express";

import {
  createRazorpayOrder,
  verifyRazorpayPayment,
  razorpayWebhook,
  resendPrepaidConfirmation,
} from "./razorpay.controller.js";

import {
  createRefundFromOrder,
  processRazorpayRefund,
  fetchRazorpayRefundStatus,
  getRefundPendingOrders,
} from "./razorpayRefund.controller.js";

import {
  getAllTransactions,
  getTransactionsByReceipt,
  getTransactionSummary,
  getAllSettlements,
  getSettlementById,
  getSettlementRecon,
  getRemittanceReport,
} from "./razorpayReports.controller.js";

const router = express.Router();

/* =========================================================
   PAYMENT FLOW
========================================================= */

router.post("/create-order", createRazorpayOrder);

router.post("/verify", verifyRazorpayPayment);

/**
 * IMPORTANT:
 * webhook route must use express.raw() in server.js / app.js
 */
router.post("/webhook", razorpayWebhook);

/* =========================================================
   ADMIN - MANUAL PREPAID CONFIRMATION
========================================================= */

router.post(
  "/admin/resend-confirmation/:orderId",
  resendPrepaidConfirmation
);

/* =========================================================
   ADMIN REFUNDS
========================================================= */

// refund queue
router.get(
  "/admin/refunds/pending-orders",
  getRefundPendingOrders
);

// create refund record from refund_pending order
router.post(
  "/admin/refunds/order/:orderId/create",
  createRefundFromOrder
);

// process created refund via Razorpay
router.post(
  "/admin/refunds/:refundId/process",
  processRazorpayRefund
);

// fetch Razorpay refund status
router.get(
  "/admin/refunds/:refundId/status",
  fetchRazorpayRefundStatus
);

/* =========================================================
   REPORTS / TRANSACTIONS
========================================================= */

router.get(
  "/reports/transactions",
  getAllTransactions
);

router.get(
  "/reports/receipt/:receipt",
  getTransactionsByReceipt
);

router.get(
  "/reports/summary",
  getTransactionSummary
);

/* =========================================================
   REPORTS / SETTLEMENTS / REMITTANCE
========================================================= */

// keep specific routes before dynamic :id
router.get(
  "/reports/settlements/recon",
  getSettlementRecon
);

router.get(
  "/reports/remittance",
  getRemittanceReport
);

router.get(
  "/reports/settlements",
  getAllSettlements
);

router.get(
  "/reports/settlements/:id",
  getSettlementById
);

export default router;
