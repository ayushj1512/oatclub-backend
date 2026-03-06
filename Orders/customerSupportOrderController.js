// Orders/customerSupportOrderController.js
import mongoose from "mongoose";
import Order from "./Orders.js";

/* --------------------------------
   IST helpers
-------------------------------- */
const IST_OFFSET = "+05:30";

const istStartUtcFromYMD = (ymd) => {
  const s = String(ymd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

  const d = new Date(`${s}T00:00:00.000${IST_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const istEndUtcFromYMD = (ymd) => {
  const s = String(ymd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

  const d = new Date(`${s}T23:59:59.999${IST_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/* --------------------------------
   Small helpers
-------------------------------- */
const toStr = (v) => String(v ?? "").trim();
const toLower = (v) => toStr(v).toLowerCase();

const normalizeArrayParam = (v) => {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => toStr(x)).filter(Boolean);
};

const escapeRegex = (s) =>
  String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* =========================================================================
   GET: Customer support lightweight list
   GET /api/orders/customer-support
======================================================================== */
export const getCustomerSupportOrders = async (req, res) => {
  try {
    const {
      customerId,
      paymentStatus,
      fulfillmentStatus,
      isConfirmed,
      confirmFilter,
      priority,
      paymentMethod,
      customerName,
      search,

      city,
      state,

      startDate,
      endDate,
      startAt,
      endAt,

      minAmount,
      maxAmount,

      page = "1",
      limit = "50",
    } = req.query;

    const filters = {};

    /* ----------------------------
       basic filters
    ---------------------------- */
    if (customerId && mongoose.Types.ObjectId.isValid(String(customerId))) {
      filters.customerId = new mongoose.Types.ObjectId(String(customerId));
    }

    const setInOrEq = (field, raw, mapFn = (x) => x) => {
      const arr = normalizeArrayParam(raw).map(mapFn).filter(Boolean);
      if (!arr.length) return;
      if (arr.length === 1) filters[field] = arr[0];
      else filters[field] = { $in: arr };
    };

    setInOrEq("paymentStatus", paymentStatus, (x) => toStr(x));
    setInOrEq("fulfillmentStatus", fulfillmentStatus, (x) => toStr(x));
    setInOrEq("paymentMethod", paymentMethod, (x) => toLower(x));

    if (confirmFilter === "confirmed") {
      filters.isConfirmed = true;
    } else if (confirmFilter === "not_confirmed") {
      filters.isConfirmed = { $ne: true };
    } else if (isConfirmed != null) {
      filters.isConfirmed = toLower(isConfirmed) === "true";
    }

    const allowedPriority = new Set(["normal", "medium", "high"]);
    const prArr = normalizeArrayParam(priority).map((x) => toLower(x));
    const prClean = prArr.filter((p) => allowedPriority.has(p));

    if (prClean.length === 1) filters.priority = prClean[0];
    else if (prClean.length > 1) filters.priority = { $in: prClean };

    /* ----------------------------
       createdAt filter
    ---------------------------- */
    const hasStartAt = !!toStr(startAt);
    const hasEndAt = !!toStr(endAt);
    const hasStartDate = !!toStr(startDate);
    const hasEndDate = !!toStr(endDate);

    if (hasStartAt || hasEndAt || hasStartDate || hasEndDate) {
      filters.createdAt = {};

      if (hasStartAt) {
        const d = new Date(toStr(startAt));
        if (!Number.isNaN(d.getTime())) filters.createdAt.$gte = d;
      } else if (hasStartDate) {
        const d = istStartUtcFromYMD(startDate);
        if (d) filters.createdAt.$gte = d;
      }

      if (hasEndAt) {
        const d = new Date(toStr(endAt));
        if (!Number.isNaN(d.getTime())) filters.createdAt.$lte = d;
      } else if (hasEndDate) {
        const d = istEndUtcFromYMD(endDate);
        if (d) filters.createdAt.$lte = d;
      }

      if (
        !filters.createdAt.$gte &&
        !filters.createdAt.$lte &&
        !filters.createdAt.$lt
      ) {
        delete filters.createdAt;
      }
    }

    /* ----------------------------
       amount range
    ---------------------------- */
    const minA = Number(minAmount);
    const maxA = Number(maxAmount);

    if (Number.isFinite(minA) || Number.isFinite(maxA)) {
      filters.finalPayable = {};
      if (Number.isFinite(minA)) filters.finalPayable.$gte = minA;
      if (Number.isFinite(maxA)) filters.finalPayable.$lte = maxA;
    }

    /* ----------------------------
       text search
    ---------------------------- */
    const q = toStr(search || customerName);
    const cityQ = toStr(city);
    const stateQ = toStr(state);

    const andConditions = [];

    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      andConditions.push({
        $or: [
          { orderNumber: rx },
          { "shippingAddressSnapshot.fullName": rx },
          { "shippingAddressSnapshot.email": rx },
          { "shippingAddressSnapshot.phone": rx },
        ],
      });
    }

    if (cityQ) {
      andConditions.push({
        "shippingAddressSnapshot.city": new RegExp(escapeRegex(cityQ), "i"),
      });
    }

    if (stateQ) {
      andConditions.push({
        "shippingAddressSnapshot.state": new RegExp(escapeRegex(stateQ), "i"),
      });
    }

    if (andConditions.length) {
      filters.$and = andConditions;
    }

    /* ----------------------------
       pagination
    ---------------------------- */
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(
      Math.max(1, parseInt(String(limit), 10) || 50),
      100
    );
    const skip = (pageNum - 1) * limitNum;

    /* ----------------------------
       super light fields for list
    ---------------------------- */
    const LIST_FIELDS = {
      orderNumber: 1,
      createdAt: 1,
      orderDate: 1,

      paymentMethod: 1,
      paymentStatus: 1,
      fulfillmentStatus: 1,
      isConfirmed: 1,
      confirmedAt: 1,

      finalPayable: 1,
      currency: 1,

      priority: 1,
      customerSupportRemark: 1,

      "shippingAddressSnapshot.fullName": 1,
      "shippingAddressSnapshot.phone": 1,
      "shippingAddressSnapshot.email": 1,
      "shippingAddressSnapshot.city": 1,
      "shippingAddressSnapshot.state": 1,
    };

    const sort = { createdAt: -1, _id: -1 };

    const [orders, totalCount] = await Promise.all([
      Order.find(filters)
        .select(LIST_FIELDS)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Order.countDocuments(filters),
    ]);

    return res.status(200).json({
      orders,
      meta: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        hasMore: skip + orders.length < totalCount,
      },
    });
  } catch (error) {
    console.error("❌ getCustomerSupportOrders error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/* =========================================================================
   GET: Customer support single order detail
   GET /api/orders/customer-support/:id
======================================================================== */
export const getCustomerSupportOrderDetail = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const order = await Order.findById(id)
      .select({
        orderNumber: 1,
        orderDate: 1,
        createdAt: 1,
        updatedAt: 1,

        customerId: 1,

        shippingAddressSnapshot: 1,
        billingAddressSnapshot: 1,

        items: 1,

        subtotal: 1,
        discount: 1,
        shippingFee: 1,
        tax: 1,
        totalAmount: 1,
        finalPayable: 1,
        currency: 1,

        paymentMethod: 1,
        paymentStatus: 1,
        fulfillmentStatus: 1,
        isConfirmed: 1,
        confirmedAt: 1,

        shipment: 1,
        trackingDetails: 1,

        coupon: 1,
        source: 1,
        priority: 1,

        customerMessage: 1,
        adminRemarks: 1,
        customerSupportRemark: 1,

        analytics: 1,
      })
      .populate({
        path: "customerId",
        select: "name email phone",
      })
      .lean();

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    return res.status(200).json({ order });
  } catch (error) {
    console.error("❌ getCustomerSupportOrderDetail error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};