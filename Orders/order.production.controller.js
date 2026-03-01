import mongoose from "mongoose";
import Order from "./Orders.js";

/* ---------------- helpers ---------------- */

const toArray = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(toArray);
  if (typeof v === "string") {
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

const parseBool = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
};

const buildSort = (sortStr) => {
  const raw = String(sortStr || "").trim();
  if (!raw) return { createdAt: -1 };

  const [field, dir] = raw.split(":").map((s) => s.trim());
  if (!field) return { createdAt: -1 };

  const order = String(dir || "desc").toLowerCase() === "asc" ? 1 : -1;
  return { [field]: order };
};

/**
 * IST-safe date range
 * from/to are YYYY-MM-DD
 * Converts to IST day boundaries then to UTC Date
 */
const IST_OFFSET_MIN = 330; // +05:30
const buildDateRangeIST = (from, to) => {
  const range = {};

  const mkUTCFromIST = (ymd, endOfDay = false) => {
    // create UTC milliseconds corresponding to IST local time
    // start: 00:00:00.000 IST
    // end:   23:59:59.999 IST
    const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
    // treat string as if it's in IST, then subtract IST offset to get UTC
    const d = new Date(`${ymd}T${time}Z`); // temporary UTC
    if (Number.isNaN(d.getTime())) return null;
    const ms = d.getTime() - IST_OFFSET_MIN * 60 * 1000; // shift back to UTC
    return new Date(ms);
  };

  if (from) {
    const d = mkUTCFromIST(from, false);
    if (d && !Number.isNaN(d.getTime())) range.$gte = d;
  }
  if (to) {
    const d = mkUTCFromIST(to, true);
    if (d && !Number.isNaN(d.getTime())) range.$lte = d;
  }

  return Object.keys(range).length ? range : null;
};

/* ============================================================
   ✅ PRODUCTION QUEUE (Confirmed Orders Only)
   - Default fulfillmentStatus = processing
   - Supports:
     - all=true  -> returns all matching orders (no pagination)
     - limit=0   -> returns all matching orders (no pagination)
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
      all,
    } = req.query;

    // ✅ base filters
    const filters = { isConfirmed: true };

    // ✅ fulfillmentStatus
    const statuses = toArray(fulfillmentStatus);
    if (statuses.length) {
      filters.fulfillmentStatus =
        statuses.length === 1 ? statuses[0] : { $in: statuses };
    }

    // ✅ priority
    const priorities = toArray(priority);
    if (priorities.length) {
      filters.priority =
        priorities.length === 1 ? priorities[0] : { $in: priorities };
    }

    // ✅ orderType
    const orderTypes = toArray(orderType);
    if (orderTypes.length) {
      filters.orderType =
        orderTypes.length === 1 ? orderTypes[0] : { $in: orderTypes };
    }

    // ✅ provider
    const providers = toArray(provider);
    if (providers.length) {
      filters["shipment.provider"] =
        providers.length === 1 ? providers[0] : { $in: providers };
    }

    // ✅ date range (IST-safe by orderDate)
    const dateRange = buildDateRangeIST(from, to);
    if (dateRange) filters.orderDate = dateRange;

    // ✅ search
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

    const sortObj = buildSort(sort);

    // ✅ all mode: disable pagination completely
    const wantsAll = parseBool(all) || String(limit) === "0";

    // ✅ safety cap (server protect) — still allows a LOT
    // If you truly want infinite, set this very high, but never recommended.
    const MAX_LIMIT = 5000;

    if (wantsAll) {
      const [orders, total] = await Promise.all([
        Order.find(filters)
          .populate("customerId", "name email phone")
          .populate("items.productId")
          .sort(sortObj)
          .lean(),
        Order.countDocuments(filters),
      ]);

      return res.status(200).json({
        success: true,
        count: orders.length,
        total,
        page: 1,
        limit: orders.length, // informational
        all: true,
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
    }

    // ✅ pagination (with cap)
    const pageNum = parseIntSafe(page, 1);
    const limitNumRaw = parseIntSafe(limit, 50);
    const limitNum = Math.min(limitNumRaw, MAX_LIMIT);
    const skip = (pageNum - 1) * limitNum;

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
      all: false,
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
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "processing"] }, 1, 0],
            },
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
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "delivered"] }, 1, 0],
            },
          },
          cancelled: {
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "cancelled"] }, 1, 0],
            },
          },
          rto: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "rto"] }, 1, 0] },
          },
          return_requested: {
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "return_requested"] }, 1, 0],
            },
          },
          exchange_requested: {
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "exchange_requested"] }, 1, 0],
            },
          },
          pickup_initiated: {
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "pickup_initiated"] }, 1, 0],
            },
          },
          returned: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "returned"] }, 1, 0] },
          },
          refunded: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "refunded"] }, 1, 0] },
          },
          exchanged: {
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "exchanged"] }, 1, 0],
            },
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