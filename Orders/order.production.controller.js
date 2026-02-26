import mongoose from "mongoose";
import Order from "./Orders.js";

/* ---------------- helpers ---------------- */

const toArray = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(toArray);
  if (typeof v === "string") {
    // support "a,b,c"
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [String(v)];
};

const parseIntSafe = (v, d) => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const buildSort = (sortStr) => {
  // sort=createdAt:desc OR sort=orderDate:asc
  const raw = String(sortStr || "").trim();
  if (!raw) return { createdAt: -1 };

  const [field, dir] = raw.split(":").map((s) => s.trim());
  if (!field) return { createdAt: -1 };

  const order = String(dir || "desc").toLowerCase() === "asc" ? 1 : -1;
  return { [field]: order };
};

const buildDateRange = (from, to) => {
  // expects YYYY-MM-DD
  const range = {};
  if (from) {
    const d = new Date(`${from}T00:00:00.000Z`);
    if (!isNaN(d.getTime())) range.$gte = d;
  }
  if (to) {
    const d = new Date(`${to}T23:59:59.999Z`);
    if (!isNaN(d.getTime())) range.$lte = d;
  }
  return Object.keys(range).length ? range : null;
};

/* ============================================================
   ✅ PRODUCTION QUEUE (Confirmed Orders Only)
   - Default fulfillmentStatus = processing
   - GET filters via query params
============================================================ */
export const getProductionQueue = async (req, res) => {
  try {
    const {
      fulfillmentStatus = "processing",
      priority,
      orderType,
      provider,
      q,
      from,
      to,
      page = 1,
      limit = 50,
      sort,
    } = req.query;

    // ✅ base filters
    const filters = {
      isConfirmed: true,
    };

    // ✅ fulfillmentStatus: string | csv | array
    const statuses = toArray(fulfillmentStatus);
    if (statuses.length) {
      filters.fulfillmentStatus = statuses.length === 1 ? statuses[0] : { $in: statuses };
    }

    // ✅ priority filter
    const priorities = toArray(priority);
    if (priorities.length) {
      filters.priority = priorities.length === 1 ? priorities[0] : { $in: priorities };
    }

    // ✅ orderType filter
    const orderTypes = toArray(orderType);
    if (orderTypes.length) {
      filters.orderType = orderTypes.length === 1 ? orderTypes[0] : { $in: orderTypes };
    }

    // ✅ shipment provider filter
    const providers = toArray(provider);
    if (providers.length) {
      filters["shipment.provider"] = providers.length === 1 ? providers[0] : { $in: providers };
    }

    // ✅ date range filter (orderDate)
    const dateRange = buildDateRange(from, to);
    if (dateRange) filters.orderDate = dateRange;

    // ✅ search (orderNumber + customer fields)
    const search = String(q ?? "").trim();
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filters.$or = [
        { orderNumber: rx },
        { "shippingAddressSnapshot.fullName": rx },
        { "shippingAddressSnapshot.phone": rx },
        { "shippingAddressSnapshot.email": rx },
        { "billingAddressSnapshot.fullName": rx },
        { "billingAddressSnapshot.phone": rx },
        { "billingAddressSnapshot.email": rx },
      ];
    }

    // ✅ pagination
    const pageNum = parseIntSafe(page, 1);
    const limitNum = parseIntSafe(limit, 50);
    const skip = (pageNum - 1) * limitNum;

    const sortObj = buildSort(sort);

    const [orders, total] = await Promise.all([
      Order.find(filters)
        .populate("customerId", "name email phone")
        .populate("items.productId")
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Order.countDocuments(filters),
    ]);

    return res.status(200).json({
      success: true,
      count: orders.length,
      total,
      page: pageNum,
      limit: limitNum,
      filtersApplied: {
        fulfillmentStatus: statuses,
        priority: priorities,
        orderType: orderTypes,
        provider: providers,
        q: search || "",
        from: from || "",
        to: to || "",
        sort: sortObj,
      },
      orders,
    });
  } catch (error) {
    console.error("❌ getProductionQueue Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/* ============================================================
   ✅ MARK PRODUCTION COMPLETE (Update fulfillmentStatus)
============================================================ */
export const markOrderShippedFromProduction = async (req, res) => {
  const session = await mongoose.startSession();
  const TAG = "🏭[PRODUCTION->SHIPPED]";

  try {
    const orderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    let updatedOrder = null;

    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      if (!order.isConfirmed) {
        throw new Error("Order must be confirmed before production/shipping");
      }

      if (order.fulfillmentStatus === "cancelled") {
        throw new Error("Cancelled order cannot be shipped");
      }

      if (order.fulfillmentStatus === "shipped") {
        updatedOrder = order;
        return;
      }

      order.fulfillmentStatus = "shipped";

      order.shipment = order.shipment || {};
      // ✅ keep aligned unless shipment cancelled
      if (order.shipment.status && order.shipment.status !== "cancelled") {
        order.shipment.status = "shipped";
      }

      await order.save({ session });
      updatedOrder = order;
    });

    const finalOrder = await Order.findById(updatedOrder._id).lean();

    console.log(`${TAG} ✅ Order marked shipped`, {
      orderNumber: finalOrder?.orderNumber,
      orderId: String(finalOrder?._id),
    });

    return res.status(200).json({
      success: true,
      message:
        finalOrder.fulfillmentStatus === "shipped"
          ? "Order marked shipped from production"
          : "Order already shipped",
      order: finalOrder,
    });
  } catch (error) {
    console.error(`${TAG} ❌ Error:`, error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  } finally {
    session.endSession();
  }
};

/* ============================================================
   ✅ PRODUCTION SUMMARY (Counts for dashboard)
============================================================ */
export const getProductionSummary = async (req, res) => {
  try {
    const [summary] = await Order.aggregate([
      { $match: { isConfirmed: true } },
      {
        $group: {
          _id: null,
          processing: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "processing"] }, 1, 0] },
          },
          packed: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "packed"] }, 1, 0] },
          },
          picked: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "picked"] }, 1, 0] },
          },
          shipped: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "shipped"] }, 1, 0] },
          },
          delivered: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "delivered"] }, 1, 0] },
          },
          cancelled: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "cancelled"] }, 1, 0] },
          },
          rto: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "rto"] }, 1, 0] },
          },
          return_requested: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "return_requested"] }, 1, 0] },
          },
          exchange_requested: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "exchange_requested"] }, 1, 0] },
          },
          pickup_initiated: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "pickup_initiated"] }, 1, 0] },
          },
          returned: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "returned"] }, 1, 0] },
          },
          refunded: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "refunded"] }, 1, 0] },
          },
          exchanged: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "exchanged"] }, 1, 0] },
          },
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      summary: summary || {
        processing: 0,
        packed: 0,
        picked: 0,
        shipped: 0,
        delivered: 0,
        cancelled: 0,
        rto: 0,
        return_requested: 0,
        exchange_requested: 0,
        pickup_initiated: 0,
        returned: 0,
        refunded: 0,
        exchanged: 0,
      },
    });
  } catch (err) {
    console.error("❌ getProductionSummary Error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};