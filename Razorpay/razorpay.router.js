// Razorpay/razorpay.router.js

import express from "express";
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
  razorpayWebhook,
} from "./razorpay.controller.js";

import {
  getAllTransactions,
  getTransactionsByReceipt,
  getTransactionSummary,
} from "./razorpayReports.controller.js";

const router = express.Router();

/* =========================================================
   PAYMENT FLOW
========================================================= */

/**
 * 🔹 Create Razorpay order
 * POST /api/razorpay/create-order
 * body: { mongoOrderId }
 */
router.post("/create-order", createRazorpayOrder);

/**
 * 🔹 Verify Razorpay payment (frontend success callback)
 * POST /api/razorpay/verify
 */
router.post("/verify", verifyRazorpayPayment);

/**
 * 🔹 Razorpay Webhook (fallback authority)
 *
 * ⚠️ IMPORTANT:
 * ❌ DO NOT use express.json() here
 * ✅ This route MUST be mounted with express.raw()
 *    in server.js / app.js
 */
router.post("/webhook", razorpayWebhook);

/* =========================================================
   REPORTS / TRANSACTIONS
========================================================= */

/**
 * 🔹 All Transactions (with filters)
 * GET /api/razorpay/reports/transactions
 * query:
 * ?from=2026-03-01&to=2026-03-23&status=captured&page=1&limit=20
 */
router.get("/reports/transactions", getAllTransactions);

/**
 * 🔹 Get transactions by receipt (your order number)
 * GET /api/razorpay/reports/receipt/:receipt
 */
router.get("/reports/receipt/:receipt", getTransactionsByReceipt);

/**
 * 🔹 Dashboard summary
 * GET /api/razorpay/reports/summary
 */
router.get("/reports/summary", getTransactionSummary);

export default router;