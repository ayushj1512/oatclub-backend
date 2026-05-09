import mongoose from "mongoose";
import { razorpay } from "./razorpay.instance.js";
import Order from "../Orders/Orders.js";
import OrderRefund from "../Orders/order.refunds/orderRefund.model.js";

const isObjId = (id) => mongoose.Types.ObjectId.isValid(id);
const paise = (amount) => Math.round(Number(amount || 0) * 100);

const REFUND_ACTIVE_STATUSES = [
  "created",
  "approved",
  "processing",
  "manual_required",
];

const syncOrderRefundSummary = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) return null;

  const refunds = await OrderRefund.find({ orderId }).sort({ createdAt: -1 });

  const refundedAmount = refunds
    .filter((r) => r.status === "processed")
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const pendingAmount = refunds
    .filter((r) => REFUND_ACTIVE_STATUSES.includes(r.status))
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const failedRefund = refunds.find((r) => r.status === "failed");
  const lastRefund = refunds[0] || null;

  const eligibleAmount = Number(
    order.refundSummary?.eligibleAmount || order.finalPayable || 0
  );

  let refundStatus = "not_eligible";
  let paymentStatus = order.paymentStatus;

  if (refundedAmount >= eligibleAmount && eligibleAmount > 0) {
    refundStatus = "refunded";
    paymentStatus = "refunded";
  } else if (refundedAmount > 0) {
    refundStatus = "partially_refunded";
    paymentStatus = "partially_refunded";
  } else if (pendingAmount > 0) {
    refundStatus = "refund_pending";
    paymentStatus = "refund_pending";
  } else if (failedRefund) {
    refundStatus = "failed";
    paymentStatus = "paid";
  } else {
    refundStatus = order.eligibleForRefund ? "eligible" : "not_eligible";
    paymentStatus = order.paymentStatus === "refund_pending" ? "paid" : order.paymentStatus;
  }

  order.paymentStatus = paymentStatus;
  order.eligibleForRefund = ["eligible", "refund_pending", "failed"].includes(
    refundStatus
  );

  order.refundSummary = {
    ...(order.refundSummary || {}),
    status: refundStatus,
    eligibleAmount,
    refundedAmount,
    pendingAmount,
    lastRefundId: lastRefund?._id || order.refundSummary?.lastRefundId || null,
    lastRefundNumber:
      lastRefund?.refundNumber || order.refundSummary?.lastRefundNumber || "",
    refundedAt:
      refundStatus === "refunded"
        ? order.refundSummary?.refundedAt || new Date()
        : order.refundSummary?.refundedAt || null,
    failedAt:
      refundStatus === "failed"
        ? order.refundSummary?.failedAt || new Date()
        : order.refundSummary?.failedAt || null,
    failureReason:
      refundStatus === "failed"
        ? failedRefund?.failureReason || "Refund failed"
        : order.refundSummary?.failureReason || "",
  };

  if (refundStatus === "refunded") {
    order.fulfillmentStatus = "refunded";
    order.fulfillmentDates = order.fulfillmentDates || {};
    order.fulfillmentDates.refundedAt =
      order.fulfillmentDates.refundedAt || new Date();
  }

  await order.save();
  return order;
};

export const createRefundFromOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { amount, reason = "Paid order cancelled before shipment" } = req.body;

    if (!isObjId(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (order.paymentMethod !== "razorpay") {
      return res.status(400).json({
        success: false,
        message: "Only Razorpay orders can be refunded here",
      });
    }

    if (!["paid", "refund_pending"].includes(order.paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: "Refund allowed only for paid/refund_pending orders",
      });
    }

    if (!order.razorpay?.paymentId) {
      return res.status(400).json({
        success: false,
        message: "Razorpay payment id missing",
      });
    }

    const refundAmount = Number(
      amount || order.refundSummary?.pendingAmount || order.finalPayable || 0
    );

    if (refundAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Refund amount must be greater than 0",
      });
    }

    const existing = await OrderRefund.findOne({
      orderId: order._id,
      status: {
        $in: ["created", "approved", "processing", "manual_required", "processed"],
      },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Refund already exists for this order",
        refund: existing,
      });
    }

    const refund = await OrderRefund.create({
      orderId: order._id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      paymentMethod: "razorpay",
      refundMode: "automatic",
      refundMethod: "razorpay_source",
      refundType: refundAmount >= Number(order.finalPayable || 0) ? "full" : "partial",
      amount: refundAmount,
      currency: order.currency || "INR",
      status: "created",
      reason,
      razorpay: {
        paymentId: order.razorpay.paymentId,
      },
      requestedBy: req.admin?._id || req.user?._id || null,
    });

    order.eligibleForRefund = true;
    order.paymentStatus = "refund_pending";

    order.refundSummary = {
      ...(order.refundSummary || {}),
      status: "refund_pending",
      refundType: refund.refundType,
      eligibleAmount: Number(order.refundSummary?.eligibleAmount || order.finalPayable || 0),
      pendingAmount: refundAmount,
      reason,
      lastRefundId: refund._id,
      lastRefundNumber: refund.refundNumber,
      refundRequestedAt: order.refundSummary?.refundRequestedAt || new Date(),
    };

    await order.save();

    return res.status(201).json({
      success: true,
      message: "Refund created",
      refund,
      order,
    });
  } catch (err) {
    console.error("createRefundFromOrder error:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to create refund",
    });
  }
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
      return res.status(400).json({
        success: false,
        message: "Refund already processed",
      });
    }

    if (refund.status === "processing" && refund.razorpay?.refundId) {
      return res.status(400).json({
        success: false,
        message: "Refund already initiated. Fetch status instead.",
      });
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
      return res.status(404).json({
        success: false,
        message: "Linked order not found",
      });
    }

    if (order.paymentMethod !== "razorpay") {
      return res.status(400).json({
        success: false,
        message: "Linked order is not a Razorpay order",
      });
    }

    if (!["paid", "refund_pending", "partially_refunded"].includes(order.paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: "Order payment status is not eligible for refund",
      });
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
    refund.refundMode = "automatic";
    refund.refundMethod = "razorpay_source";
    refund.razorpay.paymentId = paymentId;
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

    refund.status = rpRefund.status === "processed" ? "processed" : "processing";
    refund.razorpay.paymentId = paymentId;
    refund.razorpay.refundId = rpRefund.id;
    refund.razorpay.speed = speed;
    refund.razorpay.receipt = receipt;
    refund.razorpay.rawResponse = rpRefund;

    if (refund.status === "processed") {
      refund.processedAt = refund.processedAt || new Date();
      refund.processedBy = req.admin?._id || req.user?._id || null;
    }

    await refund.save();

    const updatedOrder = await syncOrderRefundSummary(order._id);

    return res.json({
      success: true,
      message:
        refund.status === "processed"
          ? "Razorpay refund processed"
          : "Razorpay refund initiated",
      refund,
      order: updatedOrder,
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

    const rpRefund = await razorpay.payments.fetchRefund(paymentId, razorpayRefundId);

    refund.razorpay.rawResponse = rpRefund;

    if (rpRefund.status === "processed") {
      refund.status = "processed";
      refund.processedAt = refund.processedAt || new Date();
    }

    if (rpRefund.status === "failed") {
      refund.status = "failed";
      refund.failedAt = refund.failedAt || new Date();
      refund.failureReason =
        rpRefund.error_description || rpRefund.error_reason || "Razorpay refund failed";
    }

    await refund.save();

    const updatedOrder = await syncOrderRefundSummary(refund.orderId);

    return res.json({
      success: true,
      refund,
      order: updatedOrder,
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

export const getRefundPendingOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      paymentMethod: "razorpay",
      eligibleForRefund: true,
      paymentStatus: "refund_pending",
      "refundSummary.status": "refund_pending",
    })
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (err) {
    console.error("getRefundPendingOrders error:", err);

    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to fetch refund pending orders",
    });
  }
};

