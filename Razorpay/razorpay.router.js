import express from "express";
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
} from "./razorpay.controller.js";

const router = express.Router();

// JSON endpoints
router.post("/create-order", createRazorpayOrder);
router.post("/verify", verifyRazorpayPayment);

export default router;
