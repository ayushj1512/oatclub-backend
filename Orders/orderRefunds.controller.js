// Orders/orderRefunds.controller.js
import Order from "./Orders.js";
import OrderRefund from "./order.refunds/orderRefund.model.js";

const safe = (v) => (v == null ? "" : String(v));

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildDateRange = ({ startDate, endDate }) => {
  const range = {};

  if (startDate) {
    const start = new Date(startDate);
    if (!Number.isNaN(start.getTime())) {
      start.setHours(0, 0, 0, 0);
      range.$gte = start;
    }
  }

  if (endDate) {
    const end = new Date(endDate);
    if (!Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      range.$lte = end;
    }
  }

  return Object.keys(range).length ? range : null;
};

const REFUND_TRIGGER_STATUSES = ["cancelled", "rto"];

const getRefundStage = (order = {}) => {
  const ps = safe(order?.paymentStatus).toLowerCase();
  const fs = safe(order?.fulfillmentStatus).toLowerCase();
  const rs = safe(order?.refundSummary?.status).toLowerCase();

  if (ps === "refund_pending" || rs === "refund_pending") return "refund_pending";
  if (ps === "refunded" || rs === "refunded") return "refunded";
  if (rs === "manual_required") return "manual_required";
  if (rs === "failed") return "failed";
  if (order?.eligibleForRefund) return "eligible";
  if (REFUND_TRIGGER_STATUSES.includes(fs) && ps === "paid") {
    return "action_required";
  }

  return "unknown";
};

const getRefundReasonLabel = (order = {}) => {
  const status = safe(order?.fulfillmentStatus).toLowerCase();
  const adminRemarks = safe(order?.adminRemarks).toLowerCase();
  const customerMessage = safe(order?.customerMessage).toLowerCase();

  if (order?.refundSummary?.reason) return order.refundSummary.reason;
  if (status === "rto") return "Paid Razorpay order returned to origin";
  if (adminRemarks.includes("cancelled_by_admin")) return "Cancelled by admin";
  if (customerMessage.includes("cancelled_by_customer")) return "Cancelled by customer";

  return "Eligible for refund";
};

const orderProjection = {
  orderNumber: 1,
  createdAt: 1,
  orderDate: 1,
  updatedAt: 1,
  customerId: 1,

  paymentMethod: 1,
  paymentStatus: 1,
  fulfillmentStatus: 1,
  eligibleForRefund: 1,
  refundSummary: 1,

  isConfirmed: 1,
  priority: 1,

  subtotal: 1,
  discount: 1,
  shippingFee: 1,
  tax: 1,
  totalAmount: 1,
  finalPayable: 1,
  currency: 1,

  adminRemarks: 1,
  customerMessage: 1,
  customerSupportRemark: 1,

  shippingAddressSnapshot: 1,
  billingAddressSnapshot: 1,

  razorpay: 1,
  shipment: 1,
  trackingDetails: 1,
  items: 1,
};

const shapeOrderRow = (order) => {
  const customerName =
    order?.customerId?.name || order?.shippingAddressSnapshot?.fullName || "";

  const customerEmail =
    order?.customerId?.email || order?.shippingAddressSnapshot?.email || "";

  const customerPhone =
    order?.customerId?.phone || order?.shippingAddressSnapshot?.phone || "";

  const shipmentStatus = safe(order?.shipment?.status).toLowerCase();
  const fulfillmentStatus = safe(order?.fulfillmentStatus).toLowerCase();
  const refundStage = getRefundStage(order);

  return {
    _id: order?._id,
    id: order?._id,
    orderNumber: order?.orderNumber || "",
    createdAt: order?.createdAt || order?.orderDate || null,
    updatedAt: order?.updatedAt || null,

    customerId: order?.customerId || null,
    customerName,
    customerEmail,
    customerPhone,

    shippingAddressSnapshot: order?.shippingAddressSnapshot || {},
    billingAddressSnapshot: order?.billingAddressSnapshot || {},

    paymentMethod: order?.paymentMethod || "",
    paymentStatus: order?.paymentStatus || "",
    fulfillmentStatus: order?.fulfillmentStatus || "",
    eligibleForRefund: Boolean(order?.eligibleForRefund),
    refundSummary: order?.refundSummary || {},

    isConfirmed: Boolean(order?.isConfirmed),
    priority: order?.priority || "normal",

    subtotal: num(order?.subtotal),
    discount: num(order?.discount),
    shippingFee: num(order?.shippingFee),
    tax: num(order?.tax),
    totalAmount: num(order?.totalAmount),
    finalPayable: num(order?.finalPayable),
    currency: order?.currency || "INR",

    refundStage,
    refundReasonLabel: getRefundReasonLabel(order),

    suggestedRefundAmount: num(
      order?.refundSummary?.pendingAmount ||
        order?.refundSummary?.eligibleAmount ||
        order?.finalPayable
    ),

    needsRefundAction:
      Boolean(order?.eligibleForRefund) &&
      !["refunded", "partially_refunded"].includes(
        safe(order?.paymentStatus).toLowerCase()
      ),

    shipmentStatus,
    shipmentBlockedForRefund:
      fulfillmentStatus === "rto"
        ? false
        : ["shipped", "out_for_delivery", "delivered"].includes(shipmentStatus),

    razorpay: {
      orderId: order?.razorpay?.orderId || "",
      paymentId: order?.razorpay?.paymentId || "",
      paidAt: order?.razorpay?.paidAt || null,
      amount: num(order?.razorpay?.amount),
      currency: order?.razorpay?.currency || order?.currency || "INR",
    },

    refundContext: {
      suggestedRefundAmount: num(
        order?.refundSummary?.pendingAmount ||
          order?.refundSummary?.eligibleAmount ||
          order?.finalPayable
      ),
      escalationNote:
        fulfillmentStatus === "rto"
          ? "Paid Razorpay order is RTO. Refund should be initiated."
          : refundStage === "eligible"
          ? "Order is eligible for refund and no processed refund exists yet."
          : refundStage === "refund_pending"
          ? "Refund is pending and not processed yet."
          : refundStage === "manual_required"
          ? "Manual refund is required."
          : refundStage === "failed"
          ? "Previous refund failed. Needs review."
          : "",
      internalRemarks:
        order?.customerSupportRemark ||
        order?.adminRemarks ||
        order?.customerMessage ||
        "",
    },

    shipment: order?.shipment || {},
    trackingDetails: order?.trackingDetails || {},

    items: Array.isArray(order?.items)
      ? order.items.map((it) => ({
          lineId: it?.lineId || "",
          quantity: num(it?.quantity, 1),
          price: num(it?.price),
          subtotal: num(it?.subtotal),
          selectedSize: it?.selectedSize || "",
          selectedColor: it?.selectedColor || "",
          productId: it?.productId || null,
          productSnapshot: {
            productCode: it?.productSnapshot?.productCode || "",
            title: it?.productSnapshot?.title || "",
            thumbnail: it?.productSnapshot?.thumbnail || "",
            sku: it?.productSnapshot?.sku || "",
          },
          variant: {
            sku: it?.variant?.sku || "",
            attributes: Array.isArray(it?.variant?.attributes)
              ? it.variant.attributes
              : [],
          },
        }))
      : [],
  };
};

export const getRefundPendingCandidates = async (req, res) => {
  try {
    const {
      page = "1",
      limit = "100",
      search = "",
      paymentStatus,
      startDate,
      endDate,
      sortBy = "createdAt",
      sortOrder = "desc",
      onlyActionRequired = "false",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 100), 200);
    const skip = (pageNum - 1) * limitNum;

    const filters = {
      paymentMethod: "razorpay",
      fulfillmentStatus: { $in: REFUND_TRIGGER_STATUSES },
      paymentStatus: paymentStatus
        ? String(paymentStatus)
        : { $in: ["paid", "refund_pending"] },
    };

    if (String(onlyActionRequired).toLowerCase() === "true") {
      filters.paymentStatus = "paid";
    }

    const createdAtRange = buildDateRange({ startDate, endDate });
    if (createdAtRange) filters.createdAt = createdAtRange;

    const q = safe(search).trim();
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filters.$or = [
        { orderNumber: rx },
        { "shippingAddressSnapshot.fullName": rx },
        { "shippingAddressSnapshot.phone": rx },
        { "shippingAddressSnapshot.email": rx },
        { "razorpay.paymentId": rx },
        { "razorpay.orderId": rx },
      ];
    }

    const allowedSort = new Set([
      "createdAt",
      "finalPayable",
      "orderNumber",
      "paymentStatus",
    ]);

    const finalSortBy = allowedSort.has(sortBy) ? sortBy : "createdAt";
    const finalSortOrder = String(sortOrder).toLowerCase() === "asc" ? 1 : -1;

    const sort =
      finalSortBy === "createdAt"
        ? { createdAt: finalSortOrder }
        : { [finalSortBy]: finalSortOrder, createdAt: -1 };

    const [orders, totalCount, summaryAgg] = await Promise.all([
      Order.find(filters)
        .select(orderProjection)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean()
        .populate({
          path: "customerId",
          select: "name email phone",
        }),

      Order.countDocuments(filters),

      Order.aggregate([
        { $match: filters },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalRefundAmount: { $sum: { $ifNull: ["$finalPayable", 0] } },
            paidCount: {
              $sum: {
                $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0],
              },
            },
            refundPendingCount: {
              $sum: {
                $cond: [{ $eq: ["$paymentStatus", "refund_pending"] }, 1, 0],
              },
            },
            rtoCount: {
              $sum: {
                $cond: [{ $eq: ["$fulfillmentStatus", "rto"] }, 1, 0],
              },
            },
            cancelledCount: {
              $sum: {
                $cond: [{ $eq: ["$fulfillmentStatus", "cancelled"] }, 1, 0],
              },
            },
          },
        },
      ]),
    ]);

    const rows = (orders || []).map(shapeOrderRow);

    const summary = summaryAgg?.[0] || {
      totalOrders: 0,
      totalRefundAmount: 0,
      paidCount: 0,
      refundPendingCount: 0,
      rtoCount: 0,
      cancelledCount: 0,
    };

    return res.status(200).json({
      success: true,
      summary: {
        totalOrders: num(summary.totalOrders),
        totalRefundAmount: num(summary.totalRefundAmount),
        actionRequiredCount: num(summary.paidCount),
        refundPendingCount: num(summary.refundPendingCount),
        rtoCount: num(summary.rtoCount),
        cancelledCount: num(summary.cancelledCount),
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limitNum)),
        hasMore: skip + rows.length < totalCount,
      },
      orders: rows,
    });
  } catch (error) {
    console.error("❌ getRefundPendingCandidates error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch refund candidates",
      error: error.message,
    });
  }
};

export const getEligibleUnrefundedOrders = async (req, res) => {
  try {
    const {
      page = "1",
      limit = "100",
      search = "",
      paymentMethod = "",
      refundStatus = "",
      fulfillmentStatus = "",
      startDate = "",
      endDate = "",
      sortBy = "updatedAt",
      sortOrder = "desc",
      excludeActiveRefunds = "false",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 100), 200);
    const skip = (pageNum - 1) * limitNum;

    const processedRefunds = await OrderRefund.distinct("orderId", {
      status: "processed",
    });

    const filters = {
      eligibleForRefund: true,
      _id: { $nin: processedRefunds },
      paymentStatus: { $nin: ["refunded", "partially_refunded"] },
      "refundSummary.status": {
        $nin: ["refunded", "partially_refunded"],
      },
    };

    if (paymentMethod) filters.paymentMethod = paymentMethod;
    if (refundStatus) filters["refundSummary.status"] = refundStatus;
    if (fulfillmentStatus) filters.fulfillmentStatus = fulfillmentStatus;

    if (String(excludeActiveRefunds).toLowerCase() === "true") {
      const activeRefunds = await OrderRefund.distinct("orderId", {
        status: {
          $in: ["created", "approved", "processing", "manual_required"],
        },
      });

      filters._id = {
        $nin: [...processedRefunds, ...activeRefunds],
      };
    }

    const createdAtRange = buildDateRange({ startDate, endDate });
    if (createdAtRange) filters.createdAt = createdAtRange;

    const q = safe(search).trim();
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filters.$or = [
        { orderNumber: rx },
        { "shippingAddressSnapshot.fullName": rx },
        { "shippingAddressSnapshot.phone": rx },
        { "shippingAddressSnapshot.email": rx },
        { "billingAddressSnapshot.fullName": rx },
        { "billingAddressSnapshot.phone": rx },
        { "billingAddressSnapshot.email": rx },
        { "razorpay.paymentId": rx },
        { "razorpay.orderId": rx },
      ];
    }

    const allowedSort = new Set([
      "createdAt",
      "updatedAt",
      "finalPayable",
      "orderNumber",
      "paymentStatus",
    ]);

    const finalSortBy = allowedSort.has(sortBy) ? sortBy : "updatedAt";
    const finalSortOrder = String(sortOrder).toLowerCase() === "asc" ? 1 : -1;

    const sort =
      finalSortBy === "createdAt" || finalSortBy === "updatedAt"
        ? { [finalSortBy]: finalSortOrder }
        : { [finalSortBy]: finalSortOrder, updatedAt: -1 };

    const [orders, totalCount, summaryAgg] = await Promise.all([
      Order.find(filters)
        .select(orderProjection)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean()
        .populate({
          path: "customerId",
          select: "name email phone",
        }),

      Order.countDocuments(filters),

      Order.aggregate([
        { $match: filters },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalRefundAmount: {
              $sum: {
                $ifNull: [
                  "$refundSummary.pendingAmount",
                  {
                    $ifNull: ["$refundSummary.eligibleAmount", "$finalPayable"],
                  },
                ],
              },
            },
            razorpayCount: {
              $sum: {
                $cond: [{ $eq: ["$paymentMethod", "razorpay"] }, 1, 0],
              },
            },
            codCount: {
              $sum: {
                $cond: [{ $eq: ["$paymentMethod", "cod"] }, 1, 0],
              },
            },
            rtoCount: {
              $sum: {
                $cond: [{ $eq: ["$fulfillmentStatus", "rto"] }, 1, 0],
              },
            },
            cancelledCount: {
              $sum: {
                $cond: [{ $eq: ["$fulfillmentStatus", "cancelled"] }, 1, 0],
              },
            },
            manualRequiredCount: {
              $sum: {
                $cond: [
                  { $eq: ["$refundSummary.status", "manual_required"] },
                  1,
                  0,
                ],
              },
            },
            refundPendingCount: {
              $sum: {
                $cond: [
                  { $eq: ["$refundSummary.status", "refund_pending"] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const rows = (orders || []).map(shapeOrderRow);

    const summary = summaryAgg?.[0] || {
      totalOrders: 0,
      totalRefundAmount: 0,
      razorpayCount: 0,
      codCount: 0,
      rtoCount: 0,
      cancelledCount: 0,
      manualRequiredCount: 0,
      refundPendingCount: 0,
    };

    return res.status(200).json({
      success: true,
      summary: {
        totalOrders: num(summary.totalOrders),
        totalRefundAmount: num(summary.totalRefundAmount),
        razorpayCount: num(summary.razorpayCount),
        codCount: num(summary.codCount),
        rtoCount: num(summary.rtoCount),
        cancelledCount: num(summary.cancelledCount),
        manualRequiredCount: num(summary.manualRequiredCount),
        refundPendingCount: num(summary.refundPendingCount),
        actionRequiredCount: rows.length,
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limitNum)),
        hasMore: skip + rows.length < totalCount,
      },
      orders: rows,
    });
  } catch (error) {
    console.error("❌ getEligibleUnrefundedOrders error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch eligible unrefunded orders",
      error: error.message,
    });
  }
};