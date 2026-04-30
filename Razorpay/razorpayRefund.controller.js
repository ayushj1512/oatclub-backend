import mongoose from "mongoose";
import { razorpay } from "./razorpay.instance.js";
import Order from "../Orders/Orders.js";
import OrderRefund from "../Orders/order.refunds/orderRefund.model.js";

const isObjId = (id) => mongoose.Types.ObjectId.isValid(id);
const paise = (amount) => Math.round(Number(amount || 0) * 100);

const syncOrderRefundSummary = async (orderId) => {
  const refunds = await OrderRefund.find({ orderId }).lean();

  const totalRefunded = refunds
    .filter((r) => r.status === "processed")
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const pendingRefund = refunds
    .filter((r) =>
      ["created", "approved", "processing", "manual_required"].includes(r.status)
    )
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const lastRefund = refunds.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  )[0];

  const status =
    totalRefunded > 0 && pendingRefund > 0
      ? "partially_refunded"
      : totalRefunded > 0
      ? "refunded"
      : pendingRefund > 0
      ? "pending"
      : "not_required";

  await Order.findByIdAndUpdate(orderId, {
    $set: {
      paymentStatus:
        status === "refunded"
          ? "refunded"
          : status === "partially_refunded"
          ? "partially_refunded"
          : pendingRefund > 0
          ? "refund_pending"
          : "paid",

      "refundSummary.status": status,
      "refundSummary.totalRefunded": totalRefunded,
      "refundSummary.pendingRefund": pendingRefund,
      "refundSummary.lastRefundId": lastRefund?._id || null,
      "refundSummary.lastRefundAt": lastRefund?.createdAt || null,
    },
  });
};

export const processRazorpayRefund = async (req, res) => {
  try {
    const { refundId } = req.params;
    const { speed = "normal", notes = {} } = req.body;

    if (!isObjId(refundId)) {
      return res.status(400).json({ success: false, message: "Invalid refund id" });
    }

    const refund = await OrderRefund.findById(refundId);
    if (!refund) {
      return res.status(404).json({ success: false, message: "Refund not found" });
    }

    if (refund.status === "processed") {
      return res.status(400).json({ success: false, message: "Refund already processed" });
    }

    if (refund.paymentMethod !== "razorpay") {
      return res.status(400).json({
        success: false,
        message: "This refund is not a Razorpay payment refund",
      });
    }

    if (refund.refundMethod !== "razorpay_source") {
      return res.status(400).json({
        success: false,
        message: "Refund method must be razorpay_source",
      });
    }

    const order = await Order.findById(refund.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Linked order not found" });
    }

    const paymentId = refund.razorpay?.paymentId || order.razorpay?.paymentId;

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        message: "Razorpay paymentId missing on refund/order",
      });
    }

    const amountInPaise = paise(refund.amount);
    if (amountInPaise <= 0) {
      return res.status(400).json({
        success: false,
        message: "Refund amount must be greater than 0",
      });
    }

    refund.status = "processing";
    await refund.save();

    const receipt = refund.refundNumber || `refund_${order.orderNumber}`;

    const rpRefund = await razorpay.payments.refund(paymentId, {
      amount: amountInPaise,
      speed,
      receipt,
      notes: {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        refundId: String(refund._id),
        refundNumber: refund.refundNumber,
        reason: refund.reason || "",
        ...notes,
      },
    });

    refund.status =
      rpRefund.status === "processed" ? "processed" : "processing";

    refund.refundMode = "automatic";
    refund.refundMethod = "razorpay_source";
    refund.razorpay.paymentId = paymentId;
    refund.razorpay.refundId = rpRefund.id;
    refund.razorpay.speed = speed;
    refund.razorpay.receipt = receipt;
    refund.razorpay.rawResponse = rpRefund;

    if (refund.status === "processed") {
      refund.processedAt = new Date();
      refund.processedBy = req.admin?._id || req.user?._id || null;
    }

    await refund.save();
    await syncOrderRefundSummary(order._id);

    return res.json({
      success: true,
      message: "Razorpay refund initiated",
      refund,
      razorpayRefund: rpRefund,
    });
  } catch (err) {
    console.error("processRazorpayRefund error:", err);
    return res.status(500).json({
      success: false,
      message:
        err?.error?.description ||
        err?.message ||
        "Failed to process Razorpay refund",
    });
  }
};

export const fetchRazorpayRefundStatus = async (req, res) => {
  try {
    const { refundId } = req.params;

    if (!isObjId(refundId)) {
      return res.status(400).json({ success: false, message: "Invalid refund id" });
    }

    const refund = await OrderRefund.findById(refundId);
    if (!refund) {
      return res.status(404).json({ success: false, message: "Refund not found" });
    }

    const paymentId = refund.razorpay?.paymentId;
    const razorpayRefundId = refund.razorpay?.refundId;

    if (!paymentId || !razorpayRefundId) {
      return res.status(400).json({
        success: false,
        message: "Razorpay paymentId/refundId missing",
      });
    }

    const rpRefund = await razorpay.payments.fetchRefund(
      paymentId,
      razorpayRefundId
    );

    refund.razorpay.rawResponse = rpRefund;

    if (rpRefund.status === "processed") {
      refund.status = "processed";
      refund.processedAt = refund.processedAt || new Date();
    }

    if (rpRefund.status === "failed") {
      refund.status = "failed";
      refund.failedAt = refund.failedAt || new Date();
      refund.failureReason = rpRefund.error_description || "Razorpay refund failed";
    }

    await refund.save();
    await syncOrderRefundSummary(refund.orderId);

    return res.json({
      success: true,
      refund,
      razorpayRefund: rpRefund,
    });
  } catch (err) {
    console.error("fetchRazorpayRefundStatus error:", err);
    return res.status(500).json({
      success: false,
      message:
        err?.error?.description ||
        err?.message ||
        "Failed to fetch Razorpay refund status",
    });
  }
};