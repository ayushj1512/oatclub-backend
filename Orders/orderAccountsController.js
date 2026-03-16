// Orders/orderAccountsController.js

import Order from "./Orders.js";

const IST = "Asia/Kolkata";
const MAX_LIMIT = 250;

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const money = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

const escapeRegex = (s = "") =>
  String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getMonthRangeUTCFromISTMonth = (month) => {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return null;

  const [year, monthNum] = String(month).split("-").map(Number);

  return {
    startUTC: new Date(Date.UTC(year, monthNum - 1, 1) - 330 * 60 * 1000),
    endUTC:
      monthNum === 12
        ? new Date(Date.UTC(year + 1, 0, 1) - 330 * 60 * 1000)
        : new Date(Date.UTC(year, monthNum, 1) - 330 * 60 * 1000),
  };
};

const ACTIVE_REVENUE_STATUSES = [
  "processing",
  "packed",
  "picked",
  "shipped",
  "out_for_delivery",
  "delivered",
];

const basePipeline = ({ month, search, startDate, endDate }) => {
  const pipeline = [
    {
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
        revenueDateResolved: {
          $ifNull: [
            "$createdAt",
            {
              $ifNull: ["$orderDate", "$updatedAt"],
            },
          ],
        },
      },
    },
    {
      $match: {
        paymentMethod: { $ne: "exchange" },
        paymentStatus: { $nin: ["failed", "refunded", "refund_pending"] },
        fulfillmentStatus: { $in: ACTIVE_REVENUE_STATUSES },
      },
    },
  ];

  if (month) {
    const range = getMonthRangeUTCFromISTMonth(month);
    if (range) {
      pipeline.push({
        $match: {
          revenueDateResolved: { $gte: range.startUTC, $lt: range.endUTC },
        },
      });
    }
  }

  if (startDate || endDate) {
    const revenueDateMatch = {};
    if (startDate) revenueDateMatch.$gte = new Date(`${startDate}T00:00:00.000Z`);
    if (endDate) revenueDateMatch.$lte = new Date(`${endDate}T23:59:59.999Z`);

    pipeline.push({
      $match: { revenueDateResolved: revenueDateMatch },
    });
  }

  if (search) {
    pipeline.push({
      $match: {
        orderNumber: { $regex: escapeRegex(search), $options: "i" },
      },
    });
  }

  return pipeline;
};

const buildRevenueResponse = async ({
  month,
  search,
  startDate,
  endDate,
  page,
  limit,
}) => {
  const skip = (page - 1) * limit;
  const pipeline = basePipeline({ month, search, startDate, endDate });

  const [countAgg, orders, summaryAgg, dailyAgg] = await Promise.all([
    Order.aggregate([...pipeline, { $count: "total" }]),

    Order.aggregate([
      ...pipeline,
      { $sort: { revenueDateResolved: -1, _id: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          orderNumber: 1,
          deliveredAt: "$revenueDateResolved",
          paymentMethod: 1,
          fulfillmentStatus: 1,
          revenue: { $ifNull: ["$finalPayable", 0] },
          discount: { $ifNull: ["$discount", 0] },
        },
      },
    ]),

    Order.aggregate([
      ...pipeline,
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          netRevenue: { $sum: { $ifNull: ["$finalPayable", 0] } },
          totalDiscount: { $sum: { $ifNull: ["$discount", 0] } },
          codRevenue: {
            $sum: {
              $cond: [
                { $eq: ["$paymentMethod", "cod"] },
                { $ifNull: ["$finalPayable", 0] },
                0,
              ],
            },
          },
          prepaidRevenue: {
            $sum: {
              $cond: [
                { $ne: ["$paymentMethod", "cod"] },
                { $ifNull: ["$finalPayable", 0] },
                0,
              ],
            },
          },
        },
      },
    ]),

    Order.aggregate([
      ...pipeline,
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$revenueDateResolved",
              timezone: IST,
            },
          },
          revenue: { $sum: { $ifNull: ["$finalPayable", 0] } },
          orders: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1, _id: 1 } },
    ]),
  ]);

  const totalOrders = toNum(countAgg?.[0]?.total, 0);
  const totalPages = Math.max(1, Math.ceil(totalOrders / limit));

  const summaryDoc = summaryAgg?.[0] || {};
  const days = Array.isArray(dailyAgg) ? dailyAgg : [];
  const highestRevenueDay = days[0] || null;
  const lowestRevenueDay = days.length
    ? [...days].sort((a, b) => a.revenue - b.revenue)[0]
    : null;

  return {
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
      startDate,
      endDate,
    },
    summary: {
      totalOrders: toNum(summaryDoc.totalOrders, 0),
      grossRevenue: money(
        toNum(summaryDoc.netRevenue, 0) + toNum(summaryDoc.totalDiscount, 0)
      ),
      netRevenue: money(summaryDoc.netRevenue),
      totalDiscount: money(summaryDoc.totalDiscount),
      codRevenue: money(summaryDoc.codRevenue),
      prepaidRevenue: money(summaryDoc.prepaidRevenue),
      highestRevenueDay,
      lowestRevenueDay,
    },
    orders,
  };
};

/* =========================================================
   REVENUE REPORT
   GET /api/orders/accounts/revenue-report
========================================================= */
export const getRevenueReport = async (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    const search = String(req.query.search || "").trim();
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();

    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50)
    );

    const data = await buildRevenueResponse({
      month,
      search,
      startDate,
      endDate,
      page,
      limit,
    });

    return res.status(200).json(data);
  } catch (error) {
    console.error("getRevenueReport error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch revenue report",
      error: error?.message || "Server error",
    });
  }
};

/* =========================================================
   SALES REPORT
   kept same shape for route compatibility
========================================================= */
export const getSalesReport = async (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    const search = String(req.query.search || "").trim();
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();

    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50)
    );

    const data = await buildRevenueResponse({
      month,
      search,
      startDate,
      endDate,
      page,
      limit,
    });

    return res.status(200).json(data);
  } catch (error) {
    console.error("getSalesReport error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch sales report",
      error: error?.message || "Server error",
    });
  }
};