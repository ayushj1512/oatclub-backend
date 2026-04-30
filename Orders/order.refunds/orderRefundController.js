import mongoose from "mongoose";
import Order from "../Order.js";
import OrderRefund from "./orderRefund.model.js";

const isObjId = (id) => mongoose.Types.ObjectId.isValid(id);

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const asyncHandler = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((error) => {
    console.error("OrderRefund Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
  });

const buildRefundFilter = (query = {}) => {
  const {
    search,
    status,
    paymentMethod,
    refundMode,
    refundMethod,
    refundType,
    customerId,
    orderId,
    rmaNumber,
    from,
    to,
    minAmount,
    maxAmount,
  } = query;

  const filter = {};

  if (status) filter.status = status;
  if (paymentMethod) filter.paymentMethod = paymentMethod;
  if (refundMode) filter.refundMode = refundMode;
  if (refundMethod) filter.refundMethod = refundMethod;
  if (refundType) filter.refundType = refundType;
  if (rmaNumber) filter.rmaNumber = rmaNumber;

  if (customerId && isObjId(customerId)) filter.customerId = customerId;
  if (orderId && isObjId(orderId)) filter.orderId = orderId;

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  if (minAmount || maxAmount) {
    filter.amount = {};
    if (minAmount) filter.amount.$gte = toNum(minAmount);
    if (maxAmount) filter.amount.$lte = toNum(maxAmount);
  }

  if (search) {
    const regex = new RegExp(String(search).trim(), "i");
    filter.$or = [
      { refundNumber: regex },
      { orderNumber: regex },
      { rmaNumber: regex },
      { reason: regex },
      { adminNote: regex },
      { "razorpay.paymentId": regex },
      { "razorpay.refundId": regex },
      { "payout.payoutId": regex },
      { "payout.utr": regex },
      { "manualRefund.utr": regex },
      { "manualRefund.transactionId": regex },
      { "customerRefundDetails.upiId": regex },
    ];
  }

  return filter;
};

const getPagination = (query = {}) => {
  const page = Math.max(1, toNum(query.page, 1));
  const limit = Math.min(100, Math.max(1, toNum(query.limit, 20)));
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

const getSort = (sort = "latest") => {
  const map = {
    latest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    amount_high: { amount: -1 },
    amount_low: { amount: 1 },
    processed_latest: { processedAt: -1 },
  };

  return map[sort] || map.latest;
};

const syncOrderRefundSummary = async (orderId) => {
  const refunds = await OrderRefund.find({ orderId }).lean();

  const totalRefunded = refunds
    .filter((r) => r.status === "processed")
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const pendingRefund = refunds
    .filter((r) => ["created", "approved", "processing", "manual_required"].includes(r.status))
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const lastRefund = refunds.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  )[0];

  let status = "not_required";
  if (pendingRefund > 0) status = "pending";
  if (refunds.some((r) => r.status === "processing")) status = "processing";
  if (refunds.some((r) => r.status === "manual_required")) status = "manual_required";
  if (refunds.some((r) => r.status === "failed")) status = "failed";
  if (totalRefunded > 0) status = pendingRefund > 0 ? "partially_refunded" : "refunded";

  await Order.findByIdAndUpdate(orderId, {
    $set: {
      paymentStatus:
        status === "refunded"
          ? "refunded"
          : status === "partially_refunded"
          ? "partially_refunded"
          : pendingRefund > 0
          ? "refund_pending"
          : undefined,

      "refundSummary.status": status,
      "refundSummary.totalRefunded": totalRefunded,
      "refundSummary.pendingRefund": pendingRefund,
      "refundSummary.lastRefundId": lastRefund?._id || null,
      "refundSummary.lastRefundAt": lastRefund?.createdAt || null,
    },
  });
};

export const createOrderRefund = asyncHandler(async (req, res) => {
  const {
    orderId,
    amount,
    refundMode,
    refundMethod,
    refundType = "full",
    reason = "",
    adminNote = "",
    rmaNumber = "",
    customerRefundDetails = {},
    manualRefund = {},
    proofs = [],
  } = req.body;

  if (!orderId || !isObjId(orderId)) {
    return res.status(400).json({ success: false, message: "Valid orderId is required" });
  }

  const order = await Order.findById(orderId).lean();
  if (!order) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }

  const refundAmount = toNum(amount);
  if (refundAmount <= 0) {
    return res.status(400).json({ success: false, message: "Refund amount must be greater than 0" });
  }

  const refund = await OrderRefund.create({
    orderId: order._id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    paymentMethod: order.paymentMethod,
    refundMode,
    refundMethod,
    refundType,
    amount: refundAmount,
    rmaNumber,
    reason,
    adminNote,
    customerRefundDetails,
    manualRefund,
    proofs,
    requestedBy: req.admin?._id || req.user?._id || null,
    razorpay: {
      paymentId: order?.razorpay?.paymentId || "",
    },
  });

  await syncOrderRefundSummary(order._id);

  res.status(201).json({
    success: true,
    message: "Refund created successfully",
    refund,
  });
});

export const getOrderRefunds = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = buildRefundFilter(req.query);
  const sort = getSort(req.query.sort);

  const [refunds, total] = await Promise.all([
    OrderRefund.find(filter)
      .populate("orderId", "orderNumber finalPayable paymentMethod paymentStatus fulfillmentStatus")
      .populate("customerId", "name email phone")
      .populate("requestedBy", "name email")
      .populate("approvedBy", "name email")
      .populate("processedBy", "name email")
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    OrderRefund.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: refunds,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
    },
    filters: req.query,
  });
});

export const getRefundDashboard = asyncHandler(async (req, res) => {
  const filter = buildRefundFilter(req.query);

  const [statusCounts, methodCounts, totals] = await Promise.all([
    OrderRefund.aggregate([
      { $match: filter },
      { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$amount" } } },
    ]),
    OrderRefund.aggregate([
      { $match: filter },
      { $group: { _id: "$refundMethod", count: { $sum: 1 }, amount: { $sum: "$amount" } } },
    ]),
    OrderRefund.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalRefunds: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          processedAmount: {
            $sum: { $cond: [{ $eq: ["$status", "processed"] }, "$amount", 0] },
          },
          pendingAmount: {
            $sum: {
              $cond: [
                { $in: ["$status", ["created", "approved", "processing", "manual_required"]] },
                "$amount",
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  res.json({
    success: true,
    summary: totals[0] || {
      totalRefunds: 0,
      totalAmount: 0,
      processedAmount: 0,
      pendingAmount: 0,
    },
    statusCounts,
    methodCounts,
    filters: req.query,
  });
});

export const getRefundById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isObjId(id)) {
    return res.status(400).json({ success: false, message: "Invalid refund id" });
  }

  const refund = await OrderRefund.findById(id)
    .populate("orderId")
    .populate("customerId", "name email phone")
    .populate("requestedBy", "name email")
    .populate("approvedBy", "name email")
    .populate("processedBy", "name email");

  if (!refund) {
    return res.status(404).json({ success: false, message: "Refund not found" });
  }

  res.json({ success: true, refund });
});

export const getRefundsByOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { page, limit, skip } = getPagination(req.query);

  if (!isObjId(orderId)) {
    return res.status(400).json({ success: false, message: "Invalid order id" });
  }

  const filter = { ...buildRefundFilter(req.query), orderId };

  const [refunds, total] = await Promise.all([
    OrderRefund.find(filter).sort(getSort(req.query.sort)).skip(skip).limit(limit).lean(),
    OrderRefund.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: refunds,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

export const updateOrderRefund = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isObjId(id)) {
    return res.status(400).json({ success: false, message: "Invalid refund id" });
  }

  const allowed = [
    "refundMode",
    "refundMethod",
    "refundType",
    "amount",
    "reason",
    "adminNote",
    "customerRefundDetails",
    "manualRefund",
    "payout",
  ];

  const update = {};
  allowed.forEach((key) => {
    if (req.body[key] !== undefined) update[key] = req.body[key];
  });

  const refund = await OrderRefund.findByIdAndUpdate(id, update, {
    new: true,
    runValidators: true,
  });

  if (!refund) {
    return res.status(404).json({ success: false, message: "Refund not found" });
  }

  await syncOrderRefundSummary(refund.orderId);

  res.json({
    success: true,
    message: "Refund updated successfully",
    refund,
  });
});

export const approveOrderRefund = asyncHandler(async (req, res) => {
  const refund = await OrderRefund.findByIdAndUpdate(
    req.params.id,
    {
      status: "approved",
      approvedBy: req.admin?._id || req.user?._id || null,
      approvedAt: new Date(),
    },
    { new: true, runValidators: true }
  );

  if (!refund) {
    return res.status(404).json({ success: false, message: "Refund not found" });
  }

  await syncOrderRefundSummary(refund.orderId);

  res.json({ success: true, message: "Refund approved", refund });
});

export const markRefundProcessing = asyncHandler(async (req, res) => {
  const refund = await OrderRefund.findByIdAndUpdate(
    req.params.id,
    { status: "processing" },
    { new: true, runValidators: true }
  );

  if (!refund) {
    return res.status(404).json({ success: false, message: "Refund not found" });
  }

  await syncOrderRefundSummary(refund.orderId);

  res.json({ success: true, message: "Refund marked as processing", refund });
});

export const markManualRefundProcessed = asyncHandler(async (req, res) => {
  const { utr = "", transactionId = "", paidFrom = "", paidTo = "", paidAt, proofs = [] } = req.body;

  const refund = await OrderRefund.findById(req.params.id);
  if (!refund) {
    return res.status(404).json({ success: false, message: "Refund not found" });
  }

  refund.status = "processed";
  refund.processedAt = paidAt ? new Date(paidAt) : new Date();
  refund.processedBy = req.admin?._id || req.user?._id || null;

  refund.manualRefund = {
    ...refund.manualRefund,
    utr,
    transactionId,
    paidFrom,
    paidTo,
    paidAt: refund.processedAt,
  };

  if (Array.isArray(proofs) && proofs.length) {
    refund.proofs.push(...proofs);
  }

  await refund.save();
  await syncOrderRefundSummary(refund.orderId);

  res.json({
    success: true,
    message: "Manual refund marked as processed",
    refund,
  });
});

export const markRefundFailed = asyncHandler(async (req, res) => {
  const { failureReason = "" } = req.body;

  const refund = await OrderRefund.findByIdAndUpdate(
    req.params.id,
    {
      status: "failed",
      failedAt: new Date(),
      failureReason,
    },
    { new: true, runValidators: true }
  );

  if (!refund) {
    return res.status(404).json({ success: false, message: "Refund not found" });
  }

  await syncOrderRefundSummary(refund.orderId);

  res.json({ success: true, message: "Refund marked as failed", refund });
});

export const cancelOrderRefund = asyncHandler(async (req, res) => {
  const refund = await OrderRefund.findByIdAndUpdate(
    req.params.id,
    { status: "cancelled" },
    { new: true, runValidators: true }
  );

  if (!refund) {
    return res.status(404).json({ success: false, message: "Refund not found" });
  }

  await syncOrderRefundSummary(refund.orderId);

  res.json({ success: true, message: "Refund cancelled", refund });
});

export const addRefundProof = asyncHandler(async (req, res) => {
  const { type = "screenshot", url, publicId = "", note = "" } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, message: "Proof image URL is required" });
  }

  const refund = await OrderRefund.findByIdAndUpdate(
    req.params.id,
    {
      $push: {
        proofs: {
          type,
          url,
          publicId,
          note,
          uploadedBy: req.admin?._id || req.user?._id || null,
          uploadedAt: new Date(),
        },
      },
    },
    { new: true, runValidators: true }
  );

  if (!refund) {
    return res.status(404).json({ success: false, message: "Refund not found" });
  }

  res.json({
    success: true,
    message: "Refund proof added",
    refund,
  });
});