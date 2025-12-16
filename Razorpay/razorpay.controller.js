import crypto from "crypto";
import { razorpay } from "./razorpay.instance.js";

/**
 * POST /api/razorpay/create-order
 * body: { mongoOrderId }
 */
export const createRazorpayOrder = async (req, res, next) => {
  try {
    const { mongoOrderId } = req.body;
    if (!mongoOrderId) {
      return res.status(400).json({ success: false, message: "mongoOrderId is required" });
    }

    // TEMP (replace with DB values)
    const order = {
      _id: mongoOrderId,
      orderNumber: `MIRAY-${String(mongoOrderId).slice(-6)}`,
      finalPayable: 999,
      currency: "INR",
      customer: { name: "", email: "", phone: "" },
    };

    const amountPaise = Math.round(Number(order.finalPayable || 0) * 100);
    if (!amountPaise || amountPaise < 100) {
      return res.status(400).json({ success: false, message: "Invalid order amount" });
    }

    const rpOrder = await razorpay.orders.create({
      amount: amountPaise,
      currency: order.currency || "INR",
      receipt: String(order.orderNumber || order._id),
      notes: {
        mongoOrderId: String(order._id),
        orderNumber: String(order.orderNumber || ""),
      },
    });

    return res.json({
      success: true,
      razorpayOrderId: rpOrder.id,
      amount: rpOrder.amount,
      currency: rpOrder.currency,
      mongoOrderId: String(order._id),
      orderNumber: order.orderNumber,
      customer: order.customer,
    });
  } catch (e) {
    return next(e);
  }
};

/**
 * POST /api/razorpay/verify
 * body: { mongoOrderId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
export const verifyRazorpayPayment = async (req, res, next) => {
  try {
    const { mongoOrderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!mongoOrderId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    return res.json({ success: true });
  } catch (e) {
    return next(e);
  }
};

/**
 * POST /api/razorpay/webhook
 * IMPORTANT: mounted with express.raw() in server.js
 */
export const razorpayWebhook = async (req, res, next) => {
  try {
    const sig = req.headers["x-razorpay-signature"];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) return res.status(500).send("Webhook secret not configured");

    const expected = crypto
      .createHmac("sha256", secret)
      .update(req.body) // Buffer
      .digest("hex");

    if (expected !== sig) return res.status(400).send("Invalid signature");

    const event = JSON.parse(req.body.toString("utf8"));

    // TODO: update DB using event.type + notes.mongoOrderId
    // console.log("Razorpay webhook event:", event.type);

    return res.json({ received: true });
  } catch (e) {
    return next(e);
  }
};

// ✅ optional alias (so imports won't break)
export const webhook = razorpayWebhook;
