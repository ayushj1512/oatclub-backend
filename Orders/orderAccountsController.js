// Orders/orderAccountsController.js

import Order from "./Orders.js";

const IST = "Asia/Kolkata";
const TAX_RATE = 0.05;
const DEFAULT_HSN = "62105000";
const MAX_LIMIT = 250;

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const money2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

const escapeRegex = (s = "") => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeHSN = (hsn) => {
  const v = String(hsn ?? "").trim();
  const low = v.toLowerCase();
  const isMissing =
    !v ||
    low === "na" ||
    low === "n/a" ||
    low === "null" ||
    low === "undefined" ||
    v === "0";

  return isMissing ? DEFAULT_HSN : v;
};

const getPaymentMode = (order) =>
  String(order?.paymentMethod || "").toLowerCase() === "cod" ? "COD" : "PREPAID";

const getPaymentMethodLabel = (order) => {
  const pm = String(order?.paymentMethod || "").toLowerCase();
  if (pm === "cod") return "Shiprocket";
  if (pm === "exchange") return "Exchange";
  return "Razorpay";
};

const getDeliveredAt = (order) =>
  order?.shipment?.deliveredAt ||
  order?.trackingDetails?.deliveredAt ||
  order?.shipment?.shiprocket?.deliveredAt ||
  order?.shipment?.shiprocket?.delivered_date ||
  order?.statusTimestamps?.deliveredAt ||
  order?.deliveredAt ||
  null;

const toMonthKey = (dateLike) => {
  const d = dateLike ? new Date(dateLike) : null;
  if (!d || Number.isNaN(d.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value || "";
  const m = parts.find((p) => p.type === "month")?.value || "";

  return y && m ? `${y}-${m}` : "";
};

const getMonthRangeUTCFromISTMonth = (month) => {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return null;

  const [year, monthNum] = String(month).split("-").map(Number);

  // IST month start => UTC previous day 18:30
  const startUTC = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0) - 330 * 60 * 1000);
  const endUTC =
    monthNum === 12
      ? new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0) - 330 * 60 * 1000)
      : new Date(Date.UTC(year, monthNum, 1, 0, 0, 0) - 330 * 60 * 1000);

  return { startUTC, endUTC };
};

const allocateDiscountProRata = (lineTotals, orderDiscount) => {
  const disc = Math.max(0, Number(orderDiscount || 0));
  const total = lineTotals.reduce((s, g) => s + Number(g || 0), 0);

  if (disc <= 0 || total <= 0) return lineTotals.map(() => 0);

  const raw = lineTotals.map((g) => (disc * Number(g || 0)) / total);
  const rounded = raw.map((x) => money2(x));

  const target = money2(disc);
  const sum = money2(rounded.reduce((s, x) => s + x, 0));
  const diff = money2(target - sum);

  if (diff !== 0) {
    for (let i = lineTotals.length - 1; i >= 0; i--) {
      if (Number(lineTotals[i] || 0) > 0) {
        rounded[i] = money2(rounded[i] + diff);
        break;
      }
    }
  }

  return rounded;
};

const buildBaseAggregation = ({ month, search }) => {
  const pipeline = [];

  pipeline.push({
    $addFields: {
      deliveredAtResolved: {
        $ifNull: [
          "$shipment.deliveredAt",
          {
            $ifNull: [
              "$trackingDetails.deliveredAt",
              {
                $ifNull: [
                  "$shipment.shiprocket.deliveredAt",
                  {
                    $ifNull: [
                      "$shipment.shiprocket.delivered_date",
                      {
                        $ifNull: ["$statusTimestamps.deliveredAt", "$deliveredAt"],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });

  pipeline.push({
    $match: {
      $and: [
        {
          $or: [
            { fulfillmentStatus: "delivered" },
            { "shipment.status": "delivered" },
          ],
        },
        {
          deliveredAtResolved: { $ne: null },
        },
      ],
    },
  });

  if (month) {
    const range = getMonthRangeUTCFromISTMonth(month);
    if (range) {
      pipeline.push({
        $match: {
          deliveredAtResolved: {
            $gte: range.startUTC,
            $lt: range.endUTC,
          },
        },
      });
    }
  }

  const q = String(search || "").trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    pipeline.push({
      $match: {
        $or: [
          { orderNumber: rx },
          { "shippingAddressSnapshot.fullName": rx },
          { "shippingAddressSnapshot.state": rx },
          { paymentMethod: rx },
          { "coupon.code": rx },
          { "shipment.shiprocket.courierName": rx },
          { "items.selectedSize": rx },
          { "items.productSnapshot.hsnCode": rx },
        ],
      },
    });
  }

  return pipeline;
};

const buildRowsFromOrders = (orders = []) => {
  const rows = [];

  for (const order of orders) {
    const deliveredAt = getDeliveredAt(order);
    const deliveredMonth = toMonthKey(deliveredAt);
    if (!deliveredMonth) continue;

    const orderId = order?.orderNumber || String(order?._id || "");
    const customerName = order?.shippingAddressSnapshot?.fullName || "";
    const customerState = order?.shippingAddressSnapshot?.state || "";
    const paymentMode = getPaymentMode(order);
    const paymentMethod = getPaymentMethodLabel(order);

    const courierName =
      String(order?.shipment?.shiprocket?.courierName || "").trim() || "Shiprocket";

    const couponCode = order?.coupon?.code || "";
    const orderTotalAmount = toNum(order?.finalPayable, 0);

    const orderDiscountRaw =
      toNum(order?.discount, 0) || toNum(order?.coupon?.discount, 0) || 0;

    const items = Array.isArray(order?.items) ? order.items : [];

    const lineTotals = items.map((it) => {
      const qty = Math.max(0, toNum(it?.quantity, 0));
      const unitInclTax = Math.max(0, toNum(it?.price, 0));
      return qty * unitInclTax;
    });

    const grossItemsTotal = lineTotals.reduce((s, x) => s + x, 0);
    const orderDiscount = Math.min(Math.max(0, orderDiscountRaw), grossItemsTotal);
    const allocatedDiscounts = allocateDiscountProRata(lineTotals, orderDiscount);

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const qty = Math.max(0, toNum(it?.quantity, 0));
      if (qty <= 0) continue;

      const unitInclTax = Math.max(0, toNum(it?.price, 0));
      const lineTotal = Math.max(0, toNum(lineTotals[idx], 0));
      const allocatedDiscount = Math.min(lineTotal, Math.max(0, toNum(allocatedDiscounts[idx], 0)));
      const netLine = Math.max(0, lineTotal - allocatedDiscount);
      const taxableValue = netLine / (1 + TAX_RATE);
      const taxAmount = netLine - taxableValue;
      const hsnCode = normalizeHSN(it?.productSnapshot?.hsnCode);

      rows.push({
        orderId,
        deliveredAt,
        deliveredMonth,
        customerName,
        customerState,
        paymentMode,
        paymentMethod,
        courierName,
        productType: "Apparel",
        hsnCode,
        productSize: it?.selectedSize || "",
        qty,
        sellingPrice: money2(unitInclTax),
        allocatedDiscount: money2(allocatedDiscount),
        netLine: money2(netLine),
        taxableValue: money2(taxableValue),
        taxAmount: money2(taxAmount),
        taxRate: "5%",
        orderTotalAmount: money2(orderTotalAmount),
        orderDiscount: money2(orderDiscountRaw),
        couponCode,
      });
    }
  }

  return rows;
};

const getPageTotals = (rows = []) => {
  const disc = rows.reduce((s, r) => s + toNum(r.allocatedDiscount, 0), 0);
  const net = rows.reduce((s, r) => s + toNum(r.netLine, 0), 0);
  const taxable = rows.reduce((s, r) => s + toNum(r.taxableValue, 0), 0);
  const tax = rows.reduce((s, r) => s + toNum(r.taxAmount, 0), 0);

  const orderMap = new Map();
  for (const r of rows) {
    if (!orderMap.has(r.orderId)) {
      orderMap.set(r.orderId, {
        orderTotalAmount: toNum(r.orderTotalAmount, 0),
        orderDiscount: toNum(r.orderDiscount, 0),
      });
    }
  }

  let sumOrderTotal = 0;
  let sumOrderDiscount = 0;

  for (const v of orderMap.values()) {
    sumOrderTotal += v.orderTotalAmount;
    sumOrderDiscount += v.orderDiscount;
  }

  return {
    rows: rows.length,
    orders: orderMap.size,
    disc: money2(disc),
    net: money2(net),
    taxable: money2(taxable),
    tax: money2(tax),
    sumOrderTotal: money2(sumOrderTotal),
    sumOrderDiscount: money2(sumOrderDiscount),
  };
};

/* =========================================================
   GET SALES REPORT (paginated orders -> flattened rows)
   GET /api/orders/accounts/sales-report?month=2026-03&page=1&limit=100&search=
========================================================= */
export const getSalesReport = async (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    const search = String(req.query.search || "").trim();

    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50)
    );
    const skip = (page - 1) * limit;

    const basePipeline = buildBaseAggregation({ month, search });

    const [countAgg, orders] = await Promise.all([
      Order.aggregate([
        ...basePipeline,
        { $count: "total" },
      ]),
      Order.aggregate([
        ...basePipeline,
        { $sort: { deliveredAtResolved: -1, _id: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            _id: 1,
            orderNumber: 1,
            paymentMethod: 1,
            finalPayable: 1,
            discount: 1,
            coupon: 1,
            fulfillmentStatus: 1,
            shipment: {
              status: 1,
              deliveredAt: 1,
              shiprocket: {
                deliveredAt: 1,
                delivered_date: 1,
                courierName: 1,
              },
            },
            trackingDetails: {
              deliveredAt: 1,
            },
            statusTimestamps: {
              deliveredAt: 1,
            },
            deliveredAt: 1,
            shippingAddressSnapshot: {
              fullName: 1,
              state: 1,
            },
            items: {
              quantity: 1,
              price: 1,
              selectedSize: 1,
              productSnapshot: {
                hsnCode: 1,
              },
            },
          },
        },
      ]),
    ]);

    const totalOrders = countAgg?.[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalOrders / limit));

    const rows = buildRowsFromOrders(orders);
    const totals = getPageTotals(rows);

    return res.status(200).json({
      success: true,
      meta: {
        page,
        limit,
        totalOrders,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        month,
        search,
      },
      totals,
      rows,
    });
  } catch (error) {
    console.error("getSalesReport error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch sales report",
      error: error?.message || "Server error",
    });
  }
};