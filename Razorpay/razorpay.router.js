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
   REPORTS / TRANSACTIONS
========================================================= */

router.get("/reports/transactions", getAllTransactions);
router.get("/reports/receipt/:receipt", getTransactionsByReceipt);
router.get("/reports/summary", getTransactionSummary);

/* =========================================================
   REPORTS / SETTLEMENTS / REMITTANCE
========================================================= */

router.get("/reports/settlements", getAllSettlements);
router.get("/reports/settlements/:id", getSettlementById);
router.get("/reports/settlements/recon", getSettlementRecon);
router.get("/reports/remittance", getRemittanceReport);

export default router;