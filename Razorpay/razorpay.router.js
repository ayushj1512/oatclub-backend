import express from "express";
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
  razorpayWebhook,
} from "./razorpay.controller.js";

const router = express.Router();

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

export default router;
