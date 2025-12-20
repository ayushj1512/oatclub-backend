import crypto from "crypto";
import mongoose from "mongoose";
import { razorpay } from "./razorpay.instance.js";
import Order from "../models/Orders.js";

/**
 * POST /api/razorpay/create-order
 */
export const createRazorpayOrder = async (req, res, next) => {
  try {
    const { mongoOrderId } = req.body;

    if (!mongoOrderId || !mongoose.Types.ObjectId.isValid(mongoOrderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid mongoOrderId",
      });
    }

    const order = await Order.findById(mongoOrderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.paymentStatus === "paid") {
      return res.status(400).json({
        success: false,
        message: "Order already paid",
      });
    }

    if (order.paymentMethod !== "razorpay") {
      return res.status(400).json({
        success: false,
        message: "Order is not marked for Razorpay payment",
      });
    }

    const amountPaise = Math.round(Number(order.finalPayable) * 100);
    if (!amountPaise || amountPaise < 100) {
      return res.status(400).json({
        success: false,
        message: "Invalid order amount",
      });
    }

    const rpOrder = await razorpay.orders.create({
      amount: amountPaise,
      currency: order.currency || "INR",
      receipt: order.orderNumber,
      notes: {
        mongoOrderId: String(order._id),
        orderNumber: order.orderNumber,
      },
    });

    order.razorpay.orderId = rpOrder.id;
    order.razorpay.amount = rpOrder.amount;
    order.razorpay.currency = rpOrder.currency;
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
  } catch (err) {
    next(err);
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

    const order = await Order.findById(mongoOrderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.paymentStatus === "paid") {
      return res.json({ success: true });
    }

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Invalid signature",
      });
    }

    order.paymentStatus = "paid";
    order.paymentMethod = "online";
    order.razorpay.paymentId = razorpay_payment_id;
    order.razorpay.signature = razorpay_signature;
    order.razorpay.paidAt = new Date();

    await order.save();

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/razorpay/webhook
 * Mounted with express.raw()
 */
export const razorpayWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
      console.error("❌ RAZORPAY_WEBHOOK_SECRET missing");
      return res.status(500).send("Webhook secret not configured");
    }

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(req.body)
      .digest("hex");

    if (expectedSignature !== signature) {
      return res.status(401).send("Invalid signature");
    }

    const event = JSON.parse(req.body.toString("utf8"));
    const type = event.event;

    const entity =
      event?.payload?.payment?.entity ||
      event?.payload?.order?.entity;

    const mongoOrderId = entity?.notes?.mongoOrderId;
    if (!mongoOrderId) return res.json({ received: true });

    const order = await Order.findById(mongoOrderId);
    if (!order) return res.json({ received: true });

    if (order.paymentStatus === "paid") {
      return res.json({ received: true });
    }

    if (type === "payment.captured" || type === "order.paid") {
      order.paymentStatus = "paid";
      order.paymentMethod = "razorpay";
      order.razorpay.paymentId = entity.id;
      order.razorpay.orderId = entity.order_id;
      order.razorpay.paidAt = new Date();
      await order.save();
    }

    if (type === "payment.failed") {
      order.paymentStatus = "failed";
      await order.save();
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return res.status(500).send("Webhook error");
  }
};

// ✅ alias used by server.js
export const webhook = razorpayWebhook;
