import crypto from "crypto";
import mongoose from "mongoose";
import { razorpay } from "./razorpay.instance.js";
import Order from "../models/Orders.js";

/**
 * POST /api/razorpay/create-order
 * body: { mongoOrderId }
 */
export const createRazorpayOrder = async (req, res, next) => {
  try {
    const { mongoOrderId } = req.body;

    if (!mongoOrderId || !mongoose.Types.ObjectId.isValid(mongoOrderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid mongoOrderId" });
    }

    const order = await Order.findById(mongoOrderId);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    // 🛑 Idempotency guard
    if (order.paymentStatus === "paid") {
      return res
        .status(400)
        .json({ success: false, message: "Order already paid" });
    }

    // 🔒 Safety: ensure this order was meant for Razorpay
    if (order.paymentMethod !== "razorpay") {
      return res.status(400).json({
        success: false,
        message: "Order is not marked for Razorpay payment",
      });
    }

    const amountPaise = Math.round(Number(order.finalPayable || 0) * 100);
    if (!amountPaise || amountPaise < 100) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order amount" });
    }

    // ✅ Create Razorpay order
    const rpOrder = await razorpay.orders.create({
      amount: amountPaise,
      currency: order.currency || "INR",
      receipt: order.orderNumber,
      notes: {
        mongoOrderId: String(order._id),
        orderNumber: order.orderNumber,
      },
    });

    // ✅ Persist Razorpay gateway metadata ONLY
    order.razorpay.orderId = rpOrder.id;
    order.razorpay.amount = rpOrder.amount;
    order.razorpay.currency = rpOrder.currency;

    // ❌ DO NOT TOUCH paymentMethod HERE
    // order.paymentMethod = "online"; ❌ REMOVED
    // order.paymentMethod = "razorpay"; ❌ NOT NEEDED

    order.paymentStatus = "pending";

    await order.save();

    return res.json({
      success: true,
      razorpayOrderId: rpOrder.id,
      amount: rpOrder.amount,
      currency: rpOrder.currency,
      mongoOrderId: String(order._id),
      orderNumber: order.orderNumber,
      customer: {
        name: order.shippingAddressSnapshot?.fullName || "",
        email: order.shippingAddressSnapshot?.email || "",
        phone: order.shippingAddressSnapshot?.phone || "",
      },
    });
  } catch (e) {
    next(e);
  }
};


/**
 * POST /api/razorpay/verify
 */
export const verifyRazorpayPayment = async (req, res, next) => {
  try {
    const {
      mongoOrderId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (
      !mongoOrderId ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const order = await Order.findById(mongoOrderId);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    // 🛑 Idempotency guard
    if (order.paymentStatus === "paid") {
      return res.json({ success: true, message: "Already verified" });
    }

    // 🔒 Order ID match
    if (order.razorpay.orderId !== razorpay_order_id) {
      return res
        .status(400)
        .json({ success: false, message: "Order ID mismatch" });
    }

    // 🔐 Signature verification
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid signature" });
    }

    // ✅ Mark PAID
    order.paymentStatus = "paid";
    order.paymentMethod = "online"; // 🔒 lock method
    order.razorpay.paymentId = razorpay_payment_id;
    order.razorpay.signature = razorpay_signature;
    order.razorpay.paidAt = new Date();

    await order.save();

    return res.json({ success: true });
  } catch (e) {
    next(e);
  }
};

/**
 * POST /api/razorpay/webhook
 * IMPORTANT: must be mounted with express.raw({ type: "application/json" })
 */
export const razorpayWebhook = async (req, res, next) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
      return res.status(500).send("Webhook secret not configured");
    }

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(req.body)
      .digest("hex");

    if (expectedSignature !== signature) {
      return res.status(400).send("Invalid signature");
    }

    const event = JSON.parse(req.body.toString("utf8"));
    const payment = event?.payload?.payment?.entity;
    const mongoOrderId = payment?.notes?.mongoOrderId;

    if (!mongoOrderId) return res.json({ received: true });

    const order = await Order.findById(mongoOrderId);
    if (!order) return res.json({ received: true });

    // 🛑 Idempotency guard
    if (order.paymentStatus === "paid") {
      return res.json({ received: true });
    }

    if (event.event === "payment.captured") {
      order.paymentStatus = "paid";
      order.paymentMethod = "online";
      order.razorpay.paymentId = payment.id;
      order.razorpay.orderId = payment.order_id;
      order.razorpay.paidAt = new Date();
      await order.save();
    }

    if (event.event === "payment.failed") {
      order.paymentStatus = "failed";
      await order.save();
    }

    return res.json({ received: true });
  } catch (e) {
    next(e);
  }
};

// ✅ alias
export const webhook = razorpayWebhook;

/**
 * POST /api/razorpay/webhook
 * IMPORTANT:
 * Mount with: express.raw({ type: "application/json" })
 */
export const razorpayWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
      console.error("❌ RAZORPAY_WEBHOOK_SECRET missing");
      return res.status(500).send("Webhook secret not configured");
    }

    /* -------------------------
       1️⃣ VERIFY SIGNATURE
    ------------------------- */
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(req.body) // RAW BUFFER
      .digest("hex");

    if (expectedSignature !== signature) {
      console.error("❌ Invalid Razorpay webhook signature");
      return res.status(401).send("Invalid signature");
    }

    /* -------------------------
       2️⃣ PARSE EVENT
    ------------------------- */
    const event = JSON.parse(req.body.toString("utf8"));
    const eventType = event.event;

    console.log("📩 Razorpay Webhook:", eventType);

    /* -------------------------
       3️⃣ EXTRACT ORDER
    ------------------------- */
    const paymentEntity =
      event?.payload?.payment?.entity ||
      event?.payload?.order?.entity;

    const mongoOrderId =
      paymentEntity?.notes?.mongoOrderId ||
      paymentEntity?.notes?.order_id;

    if (!mongoOrderId) {
      console.warn("⚠️ mongoOrderId missing in webhook notes");
      return res.json({ received: true });
    }

    const order = await Order.findById(mongoOrderId);
    if (!order) {
      console.warn("⚠️ Order not found:", mongoOrderId);
      return res.json({ received: true });
    }

    /* -------------------------
       4️⃣ IDEMPOTENCY
    ------------------------- */
    if (order.paymentStatus === "paid") {
      return res.json({ received: true });
    }

    /* -------------------------
       5️⃣ HANDLE EVENTS
    ------------------------- */

    // ✅ PAYMENT SUCCESS
    if (eventType === "payment.captured" || eventType === "order.paid") {
      order.paymentStatus = "paid";
      order.paymentMethod = "razorpay";

      order.razorpay.paymentId =
        paymentEntity?.id || order.razorpay.paymentId;

      order.razorpay.orderId =
        paymentEntity?.order_id || order.razorpay.orderId;

      order.razorpay.paidAt = new Date();

      await order.save();

      console.log("✅ Order marked PAID via webhook:", order.orderNumber);
    }

    // ❌ PAYMENT FAILED
    if (eventType === "payment.failed") {
      order.paymentStatus = "failed";
      await order.save();

      console.log("❌ Payment failed:", order.orderNumber);
    }

    /* -------------------------
       6️⃣ ACKNOWLEDGE
    ------------------------- */
    return res.json({ received: true });
  } catch (err) {
    console.error("❌ Razorpay Webhook Error:", err);
    return res.status(500).send("Webhook handler error");
  }
};

// ✅ alias (optional)
export const webhook = razorpayWebhook;
