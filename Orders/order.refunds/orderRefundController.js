import mongoose from "mongoose";
import { razorpay } from "../../Razorpay/razorpay.instance.js";
import Order from "../Orders.js";
import OrderRefund from "./orderRefund.model.js";

const isObjId = (id) => mongoose.Types.ObjectId.isValid(id);
const paise = (amount) => Math.round(Number(amount || 0) * 100);

const ACTIVE_REFUND_STATUSES = [
  "created",
  "approved",
  "processing",
  "manual_required",
];

const DONE_REFUND_STATUSES = ["processed"];

const getActorId = (req) => req.admin?._id || req.user?._id || null;

const buildRefundItems = (order, selectedItems = []) => {
  if (!Array.isArray(selectedItems) || selectedItems.length === 0) return [];

  return selectedItems
    .map((selected) => {
      const line = order.items?.find(
        (item) => String(item.lineId) === String(selected.lineId)
      );

      if (!line) return null;

      const maxQty = Math.max(1, Number(line.quantity || 1));
      const qty = Math.min(Math.max(1, Number(selected.quantity || 1)), maxQty);

      const price = Number(line.price || 0);
      const subtotal = Number(line.subtotal || price * maxQty);
      const proportionalSubtotal = (subtotal / maxQty) * qty;
      const refundAmount = Number(selected.refundAmount || proportionalSubtotal);

      return {
        lineId: line.lineId,
        productModel: line.productModel || "Product",
        productId: line.productId || null,
        productCode: line.productSnapshot?.productCode || "",
        title: line.productSnapshot?.title || "",
        sku: line.variant?.sku || line.productSnapshot?.sku || "",
        selectedSize: line.selectedSize || "",
        selectedColor: line.selectedColor || "",
        thumbnail: line.productSnapshot?.thumbnail || "",
        quantity: qty,
        price,
        subtotal: proportionalSubtotal,
        refundAmount,
      };
    })
    .filter(Boolean);
};

const calculateRefundPayload = ({ order, amount, refundType = "full", selectedItems = [] }) => {
  if (refundType === "partial" && selectedItems.length > 0) {
    const items = buildRefundItems(order, selectedItems);
    const itemAmount = items.reduce(
      (sum, item) => sum + Number(item.refundAmount || 0),
      0
    );

    return {
      refundType: "partial",
      amount: itemAmount,
      items,
    };
  }

  const refundAmount = Number(
    amount || order.refundSummary?.pendingAmount || order.finalPayable || 0
  );

  return {
    refundType: refundAmount >= Number(order.finalPayable || 0) ? "full" : "partial",
    amount: refundAmount,
    items: [],
  };
};

const pushRefundIntoOrderSummary = ({ order, refund, refundAmount, refundType, reason, adminNote = "" }) => {
  const oldIds = Array.isArray(order.refundSummary?.refundIds)
    ? order.refundSummary.refundIds
    : [];

  order.eligibleForRefund = true;
  order.paymentStatus = "refund_pending";

  order.refundSummary = {
    ...(order.refundSummary || {}),
    status: "refund_pending",
    refundType,
    eligibleAmount: Number(order.refundSummary?.eligibleAmount || order.finalPayable || refundAmount),
    refundedAmount: Number(order.refundSummary?.refundedAmount || 0),
    pendingAmount: refundAmount,
    reason,
    adminNote,
    lastRefundId: refund._id,
    lastRefundNumber: refund.refundNumber,
    refundIds: [...oldIds, refund._id],
    refundRequestedAt: order.refundSummary?.refundRequestedAt || new Date(),
  };
};

const normalizeRefundStatusForOrder = ({
  order,
  refundedAmount,
  pendingAmount,
  failedRefund,
}) => {
  const eligibleAmount = Number(
    order.refundSummary?.eligibleAmount || order.finalPayable || 0
  );

  let refundStatus = order.eligibleForRefund ? "eligible" : "not_eligible";
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
    paymentStatus =
      order.paymentMethod === "razorpay" ? "paid" : order.paymentStatus;
  }

  return { refundStatus, paymentStatus, eligibleAmount };
};

const syncOrderRefundSummary = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) return null;

  const refunds = await OrderRefund.find({ orderId }).sort({ createdAt: -1 });

  const refundedAmount = refunds
    .filter((r) => DONE_REFUND_STATUSES.includes(r.status))
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const pendingAmount = refunds
    .filter((r) => ACTIVE_REFUND_STATUSES.includes(r.status))
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const failedRefund = refunds.find((r) => r.status === "failed");
  const lastRefund = refunds[0] || null;

  const { refundStatus, paymentStatus, eligibleAmount } =
    normalizeRefundStatusForOrder({
      order,
      refundedAmount,
      pendingAmount,
      failedRefund,
    });

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

    // ✅ all refund links
    refundIds: refunds.map((r) => r._id),

    // ✅ latest refund link
    lastRefundId: lastRefund?._id || null,
    lastRefundNumber: lastRefund?.refundNumber || "",

    // ✅ keep latest type/reason if available
    refundType: lastRefund?.refundType || order.refundSummary?.refundType || "full",
    reason: lastRefund?.reason || order.refundSummary?.reason || "",

    refundedAt:
      refundStatus === "refunded"
        ? order.refundSummary?.refundedAt || new Date()
        : refundStatus === "partially_refunded"
        ? order.refundSummary?.refundedAt || new Date()
        : order.refundSummary?.refundedAt || null,

    failedAt:
      refundStatus === "failed"
        ? failedRefund?.failedAt || order.refundSummary?.failedAt || new Date()
        : null,

    failureReason:
      refundStatus === "failed"
        ? failedRefund?.failureReason || "Refund failed"
        : "",
  };

  if (refundStatus === "refunded") {
    order.eligibleForRefund = false;
    order.fulfillmentStatus = "refunded";
    order.fulfillmentDates = order.fulfillmentDates || {};
    order.fulfillmentDates.refundedAt =
      order.fulfillmentDates.refundedAt || new Date();
  }

  await order.save();
  return order;
};

/* =========================================================
   LIST / QUEUE
========================================================= */

export const getRefundPendingOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      eligibleForRefund: true,
      paymentStatus: "refund_pending",
      "refundSummary.status": "refund_pending",
    })
      .populate("customerId", "name email phone")
      .sort({ updatedAt: -1 })
      .lean();

    const totalRefundAmount = orders.reduce((sum, order) => {
      return (
        sum +
        Number(
          order?.refundSummary?.pendingAmount ||
            order?.refundSummary?.eligibleAmount ||
            order?.finalPayable ||
            0
        )
      );
    }, 0);

    return res.json({
      success: true,
      count: orders.length,
      summary: {
        totalOrders: orders.length,
        totalRefundAmount,
        actionRequiredCount: orders.length,
        refundPendingCount: orders.length,
      },
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

export const getAllRefunds = async (req, res) => {
  try {
    const {
      status = "",
      paymentMethod = "",
      refundMode = "",
      search = "",
      page = 1,
      limit = 50,
    } = req.query;

    const query = {};

    if (status) query.status = status;
    if (paymentMethod) query.paymentMethod = paymentMethod;
    if (refundMode) query.refundMode = refundMode;

    if (search) {
      query.$or = [
        { refundNumber: { $regex: search, $options: "i" } },
        { orderNumber: { $regex: search, $options: "i" } },
        { rmaNumber: { $regex: search, $options: "i" } },
        { "razorpay.refundId": { $regex: search, $options: "i" } },
        { "manualRefund.utr": { $regex: search, $options: "i" } },
      ];
    }

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const skip = (safePage - 1) * safeLimit;

    const [refunds, totalCount] = await Promise.all([
      OrderRefund.find(query)
        .populate("customerId", "name email phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      OrderRefund.countDocuments(query),
    ]);

    return res.json({
      success: true,
      refunds,
      pagination: {
        page: safePage,
        limit: safeLimit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
        hasMore: skip + refunds.length < totalCount,
      },
    });
  } catch (err) {
    console.error("getAllRefunds error:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to fetch refunds",
    });
  }
};

export const getRefundById = async (req, res) => {
  try {
    const { refundId } = req.params;

    if (!isObjId(refundId)) {
      return res.status(400).json({ success: false, message: "Invalid refund id" });
    }

    const refund = await OrderRefund.findById(refundId)
      .populate("customerId", "name email phone")
      .lean();

    if (!refund) {
      return res.status(404).json({ success: false, message: "Refund not found" });
    }

    const order = await Order.findById(refund.orderId).lean();

    return res.json({
      success: true,
      refund,
      order,
    });
  } catch (err) {
    console.error("getRefundById error:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to fetch refund",
    });
  }
};

/* =========================================================
   RAZORPAY REFUNDS
========================================================= */

export const createRefundFromOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const {
  amount,
  refundType = "full",
  selectedItems = [],
  reason = "Paid order cancelled before shipment",
} = req.body;

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

    if (!["paid", "refund_pending", "partially_refunded"].includes(order.paymentStatus)) {
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

    const calculated = calculateRefundPayload({
  order,
  amount,
  refundType,
  selectedItems,
});

const refundAmount = calculated.amount;
const refundItems = calculated.items;
const finalRefundType = calculated.refundType;

    if (refundAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Refund amount must be greater than 0",
      });
    }

    const existing = await OrderRefund.findOne({
      orderId: order._id,
      status: { $in: [...ACTIVE_REFUND_STATUSES, "processed"] },
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
      refundType: finalRefundType,
items: refundItems,
amount: refundAmount,
      currency: order.currency || "INR",
      status: "created",
      reason,
      customerVisible: true,
      customerMessage: "Your refund request has been created.",
      razorpay: {
        paymentId: order.razorpay.paymentId,
      },
      requestedBy: getActorId(req),
    });

   pushRefundIntoOrderSummary({
  order,
  refund,
  refundAmount,
  refundType: finalRefundType,
  reason,
});

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
    refund.customerMessage = "Your refund has been initiated.";
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
      refund.processedBy = getActorId(req);
      refund.customerMessage = "Your refund has been processed successfully.";
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
      refund.customerMessage = "Your refund has been processed successfully.";
    }

    if (rpRefund.status === "failed") {
      refund.status = "failed";
      refund.failedAt = refund.failedAt || new Date();
      refund.failureReason =
        rpRefund.error_description || rpRefund.error_reason || "Razorpay refund failed";
      refund.customerMessage =
        "Your refund could not be processed. Our team will review it.";
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

/* =========================================================
   COD / MANUAL REFUNDS
========================================================= */

export const createManualRefundFromOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const {
  amount,
  refundType = "full",
  selectedItems = [],
  reason = "Manual refund requested",
  refundMethod = "upi",
  customerRefundDetails = {},
  adminNote = "",
  customerMessage = "Your refund request has been created.",
} = req.body;

    if (!isObjId(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (!["cod", "exchange", "razorpay"].includes(order.paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "Unsupported payment method for manual refund",
      });
    }

    const calculated = calculateRefundPayload({
  order,
  amount,
  refundType,
  selectedItems,
});

const refundAmount = calculated.amount;
const refundItems = calculated.items;
const finalRefundType = calculated.refundType;

    if (refundAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Refund amount must be greater than 0",
      });
    }

    const allowedManualMethods = [
      "upi",
      "bank_transfer",
      "cash",
      "store_credit",
      "other",
    ];

    if (!allowedManualMethods.includes(refundMethod)) {
      return res.status(400).json({
        success: false,
        message: "Invalid manual refund method",
      });
    }

    const existing = await OrderRefund.findOne({
      orderId: order._id,
      status: { $in: [...ACTIVE_REFUND_STATUSES, "processed"] },
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
      paymentMethod: order.paymentMethod || "cod",
      refundMode: "manual",
      refundMethod,
refundType: finalRefundType,
items: refundItems,
amount: refundAmount,
currency: order.currency || "INR",
      currency: order.currency || "INR",
      status: "manual_required",
      reason,
      adminNote,
      customerVisible: true,
      customerMessage,
      customerRefundDetails: {
        mode:
          refundMethod === "bank_transfer"
            ? "bank"
            : refundMethod === "store_credit"
            ? "store_credit"
            : refundMethod === "cash"
            ? "cash"
            : "upi",
        upiId: customerRefundDetails?.upiId || "",
        accountHolderName: customerRefundDetails?.accountHolderName || "",
        bankName: customerRefundDetails?.bankName || "",
        accountNumberLast4: customerRefundDetails?.accountNumberLast4 || "",
        ifsc: customerRefundDetails?.ifsc || "",
        note: customerRefundDetails?.note || "",
      },
      requestedBy: getActorId(req),
    });

   pushRefundIntoOrderSummary({
  order,
  refund,
  refundAmount,
  refundType: finalRefundType,
  reason,
  adminNote,
});

    await order.save();

    return res.status(201).json({
      success: true,
      message: "Manual refund created",
      refund,
      order,
    });
  } catch (err) {
    console.error("createManualRefundFromOrder error:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to create manual refund",
    });
  }
};

export const markManualRefundProcessed = async (req, res) => {
  try {
    const { refundId } = req.params;

    const {
      transactionId = "",
      utr = "",
      paidFrom = "",
      paidTo = "",
      paidAt = null,
      handledByName = "",
      proofs = [],
      customerMessage = "Your refund has been processed successfully.",
      notifyCustomer = false,
      notificationChannel = "manual",
    } = req.body;

    if (!isObjId(refundId)) {
      return res.status(400).json({ success: false, message: "Invalid refund id" });
    }

    const refund = await OrderRefund.findById(refundId);

    if (!refund) {
      return res.status(404).json({ success: false, message: "Refund not found" });
    }

    if (refund.refundMode !== "manual") {
      return res.status(400).json({
        success: false,
        message: "Only manual refunds can be marked processed here",
      });
    }

    if (refund.status === "processed") {
      return res.status(400).json({
        success: false,
        message: "Refund already processed",
      });
    }

    refund.status = "processed";
    refund.processedBy = getActorId(req);
    refund.processedAt = refund.processedAt || new Date();

    refund.manualRefund = {
      ...(refund.manualRefund || {}),
      transactionId,
      utr,
      paidFrom,
      paidTo,
      paidAt: paidAt ? new Date(paidAt) : new Date(),
      handledByName,
    };

    if (Array.isArray(proofs) && proofs.length > 0) {
      const cleanProofs = proofs
        .filter((p) => p?.url)
        .map((p) => ({
          type: p.type || "screenshot",
          url: p.url,
          publicId: p.publicId || "",
          uploadedBy: getActorId(req),
          note: p.note || "",
          uploadedAt: new Date(),
        }));

      refund.proofs = [...(refund.proofs || []), ...cleanProofs];
    }

    refund.customerMessage = customerMessage;

    if (notifyCustomer) {
      refund.notification = {
        ...(refund.notification || {}),
        customerNotified: true,
        notifiedAt: new Date(),
        channel: notificationChannel,
        lastMessage: customerMessage,
      };
    }

    await refund.save();

    const updatedOrder = await syncOrderRefundSummary(refund.orderId);

    return res.json({
      success: true,
      message: "Manual refund marked as processed",
      refund,
      order: updatedOrder,
    });
  } catch (err) {
    console.error("markManualRefundProcessed error:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to mark manual refund processed",
    });
  }
};

export const markManualRefundFailed = async (req, res) => {
  try {
    const { refundId } = req.params;
    const { failureReason = "Manual refund failed" } = req.body;

    if (!isObjId(refundId)) {
      return res.status(400).json({ success: false, message: "Invalid refund id" });
    }

    const refund = await OrderRefund.findById(refundId);

    if (!refund) {
      return res.status(404).json({ success: false, message: "Refund not found" });
    }

    if (refund.refundMode !== "manual") {
      return res.status(400).json({
        success: false,
        message: "Only manual refunds can be marked failed here",
      });
    }

    refund.status = "failed";
    refund.failedAt = refund.failedAt || new Date();
    refund.failureReason = failureReason;
    refund.customerMessage =
      "Your refund could not be completed. Our team will review it.";

    await refund.save();

    const updatedOrder = await syncOrderRefundSummary(refund.orderId);

    return res.json({
      success: true,
      message: "Manual refund marked as failed",
      refund,
      order: updatedOrder,
    });
  } catch (err) {
    console.error("markManualRefundFailed error:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to mark manual refund failed",
    });
  }
};

/* =========================================================
   PROOFS
========================================================= */

export const addRefundProof = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      type = "screenshot",
      url = "",
      publicId = "",
      note = "",
    } = req.body;

    if (!isObjId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid refund id",
      });
    }

    if (!url) {
      return res.status(400).json({
        success: false,
        message: "Proof URL is required",
      });
    }

    const refund = await OrderRefund.findById(id);

    if (!refund) {
      return res.status(404).json({
        success: false,
        message: "Refund not found",
      });
    }

    refund.proofs = [
      ...(refund.proofs || []),
      {
        type,
        url,
        publicId,
        note,
        uploadedBy: getActorId(req),
        uploadedAt: new Date(),
      },
    ];

    await refund.save();

    const order = await Order.findById(refund.orderId).lean();

    return res.json({
      success: true,
      message: "Refund proof added",
      refund,
      order,
    });
  } catch (err) {
    console.error("addRefundProof error:", err);

    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to add refund proof",
    });
  }
};