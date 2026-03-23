// Orders/orderReportsController.js

import Order from "./Orders.js";
import MarketingSpend from "../MarketingSpend/MarketingSpend.js"; // path adjust if needed

const toInt = (v, d = 0) => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const IST_TZ = "Asia/Kolkata";

/* =========================================================
   COMMON HELPERS
========================================================= */

const buildMonthRange = (month) => {
  const raw = String(month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return null;

  const [y, m] = raw.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;

  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));

  return { start, end };
};

const buildConfirmedBusinessMatch = (month = "") => {
  const monthRange = buildMonthRange(month);

  const match = {
    isConfirmed: true,
    orderType: { $ne: "parent" },
    paymentStatus: { $nin: ["failed"] },
    fulfillmentStatus: { $nin: ["cancelled", "failed"] },
    paymentMethod: { $ne: "exchange" },
  };

  if (monthRange) {
    match.orderDate = {
      $gte: monthRange.start,
      $lt: monthRange.end,
    };
  }

  return { match, monthRange };
};

const parseDateYMD = (value = "") => {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
};

const buildDateRangeFromQuery = ({ from = "", to = "" }) => {
  const fromYMD = parseDateYMD(from);
  const toYMD = parseDateYMD(to);

  if (!fromYMD && !toYMD) {
    return {
      from: "",
      to: "",
      startUtc: null,
      endUtc: null,
    };
  }

  const normalizedFrom = fromYMD || "";
  const normalizedTo = toYMD || "";

  const startUtc = fromYMD
    ? new Date(`${fromYMD}T00:00:00.000+05:30`)
    : null;

  const endUtc = toYMD
    ? new Date(
        new Date(`${toYMD}T00:00:00.000+05:30`).getTime() + 24 * 60 * 60 * 1000
      )
    : null;

  return {
    from: normalizedFrom,
    to: normalizedTo,
    startUtc,
    endUtc,
  };
};

const buildOrderDateExpr = () => ({
  $ifNull: [
    "$placedAt",
    {
      $ifNull: [
        "$createdAt",
        {
          $ifNull: [
            "$orderDate",
            {
              $ifNull: ["$paidAt", "$createdAt"],
            },
          ],
        },
      ],
    },
  ],
});

const buildOrderRevenueExpr = () => ({
  $ifNull: [
    "$finalPayable",
    {
      $ifNull: [
        "$pricing.finalPayable",
        {
          $ifNull: [
            "$coupon.finalTotal",
            {
              $ifNull: [
                "$amountPaid",
                {
                  $ifNull: [
                    "$payableAmount",
                    {
                      $ifNull: [
                        "$netAmount",
                        {
                          $ifNull: [
                            "$pricing.payable",
                            {
                              $ifNull: [
                                "$pricing.grandTotal",
                                {
                                  $ifNull: [
                                    "$grandTotal",
                                    {
                                      $ifNull: ["$total", "$totalAmount"],
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

const buildOrderExcludedExpr = () => ({
  $or: [
    {
      $in: [
        { $toLower: { $ifNull: ["$fulfillmentStatus", ""] } },
        ["cancelled", "canceled", "failed"],
      ],
    },
    {
      $in: [
        { $toLower: { $ifNull: ["$paymentStatus", ""] } },
        ["cancelled", "canceled", "failed"],
      ],
    },
    {
      $in: [
        { $toLower: { $ifNull: ["$status", ""] } },
        ["cancelled", "canceled", "failed"],
      ],
    },
    {
      $in: [
        { $toLower: { $ifNull: ["$shipment.status", ""] } },
        ["cancelled", "canceled", "failed"],
      ],
    },
  ],
});

const buildOrderRangeMatch = ({ from = "", to = "" }) => {
  const { startUtc, endUtc } = buildDateRangeFromQuery({ from, to });
  const dateExpr = buildOrderDateExpr();

  const and = [];

  if (startUtc) {
    and.push({
      $expr: {
        $gte: [dateExpr, startUtc],
      },
    });
  }

  if (endUtc) {
    and.push({
      $expr: {
        $lt: [dateExpr, endUtc],
      },
    });
  }

  return and.length ? { $and: and } : {};
};

const buildSpendRangeMatch = ({ from = "", to = "", source = "" }) => {
  const { startUtc, endUtc } = buildDateRangeFromQuery({ from, to });

  const dateExpr = {
    $ifNull: [
      "$spentAt",
      {
        $ifNull: ["$date", { $ifNull: ["$createdAt", "$updatedAt"] }],
      },
    ],
  };

  const and = [];

  if (startUtc) {
    and.push({
      $expr: {
        $gte: [dateExpr, startUtc],
      },
    });
  }

  if (endUtc) {
    and.push({
      $expr: {
        $lt: [dateExpr, endUtc],
      },
    });
  }

  if (String(source || "").trim()) {
    and.push({
      source: String(source).trim(),
    });
  }

  return and.length ? { $and: and } : {};
};

/* =========================================================
   PRODUCT SALES REPORT
========================================================= */

export const getProductSalesReport = async (req, res) => {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
    const skip = (page - 1) * limit;

    const month = String(req.query.month || "").trim();
    const search = String(req.query.search || "").trim();
    const sort = String(req.query.sort || "qty_desc").trim();

    const { match, monthRange } = buildConfirmedBusinessMatch(month);

    const sortMap = {
      qty_desc: { qty: -1, productName: 1 },
      qty_asc: { qty: 1, productName: 1 },
      name_asc: { productName: 1, qty: -1 },
      name_desc: { productName: -1, qty: -1 },
      price_desc: { sellingPrice: -1, qty: -1, productName: 1 },
      price_asc: { sellingPrice: 1, qty: -1, productName: 1 },
      code_asc: { productCode: 1, qty: -1 },
      code_desc: { productCode: -1, qty: -1 },
    };

    const finalSort = sortMap[sort] || sortMap.qty_desc;

    const pipeline = [
      { $match: match },
      {
        $facet: {
          orderStats: [
            {
              $group: {
                _id: null,
                totalOrders: { $sum: 1 },
              },
            },
          ],
          productData: [
            {
              $project: {
                _id: 0,
                items: { $ifNull: ["$items", []] },
              },
            },
            { $unwind: "$items" },
            {
              $project: {
                productId: "$items.productId",
                variantId: "$items.variant.variantId",
                productCode: {
                  $trim: {
                    input: {
                      $toString: {
                        $ifNull: ["$items.productSnapshot.productCode", ""],
                      },
                    },
                  },
                },
                productName: {
                  $trim: {
                    input: {
                      $toString: {
                        $ifNull: ["$items.productSnapshot.title", ""],
                      },
                    },
                  },
                },
                productImage: {
                  $let: {
                    vars: {
                      thumb: {
                        $ifNull: ["$items.productSnapshot.thumbnail", ""],
                      },
                      firstImage: {
                        $arrayElemAt: [
                          { $ifNull: ["$items.productSnapshot.images", []] },
                          0,
                        ],
                      },
                    },
                    in: {
                      $cond: [
                        { $ne: ["$$thumb", ""] },
                        "$$thumb",
                        { $ifNull: ["$$firstImage", ""] },
                      ],
                    },
                  },
                },
                qty: { $ifNull: ["$items.quantity", 0] },
                price: { $ifNull: ["$items.price", 0] },
                subtotal: {
                  $cond: [
                    { $gt: [{ $ifNull: ["$items.subtotal", 0] }, 0] },
                    "$items.subtotal",
                    {
                      $multiply: [
                        { $ifNull: ["$items.price", 0] },
                        { $ifNull: ["$items.quantity", 0] },
                      ],
                    },
                  ],
                },
              },
            },
            {
              $match: {
                qty: { $gt: 0 },
                productCode: { $ne: "" },
              },
            },
            ...(search
              ? [
                  {
                    $match: {
                      $or: [
                        {
                          productCode: {
                            $regex: escapeRegex(search),
                            $options: "i",
                          },
                        },
                        {
                          productName: {
                            $regex: escapeRegex(search),
                            $options: "i",
                          },
                        },
                      ],
                    },
                  },
                ]
              : []),
            {
              $group: {
                _id: "$productCode",
                productCode: { $first: "$productCode" },
                productName: { $first: "$productName" },
                productImage: { $first: "$productImage" },
                productId: { $first: "$productId" },
                qty: { $sum: "$qty" },
                revenue: { $sum: "$subtotal" },
                priceQtyValue: {
                  $sum: {
                    $multiply: ["$price", "$qty"],
                  },
                },
                rawNames: { $addToSet: "$productName" },
                rawImages: { $addToSet: "$productImage" },
              },
            },
            {
              $project: {
                _id: 0,
                key: "$productCode",
                productCode: 1,
                productId: 1,
                productName: {
                  $cond: [
                    { $ne: ["$productName", ""] },
                    "$productName",
                    { $ifNull: [{ $arrayElemAt: ["$rawNames", 0] }, ""] },
                  ],
                },
                productImage: {
                  $cond: [
                    { $ne: ["$productImage", ""] },
                    "$productImage",
                    { $ifNull: [{ $arrayElemAt: ["$rawImages", 0] }, ""] },
                  ],
                },
                qty: 1,
                revenue: { $round: [{ $ifNull: ["$revenue", 0] }, 2] },
                sellingPrice: {
                  $round: [
                    {
                      $cond: [
                        { $gt: ["$qty", 0] },
                        { $divide: ["$priceQtyValue", "$qty"] },
                        0,
                      ],
                    },
                    2,
                  ],
                },
              },
            },
          ],
        },
      },
      {
        $project: {
          totalOrders: {
            $ifNull: [{ $arrayElemAt: ["$orderStats.totalOrders", 0] }, 0],
          },
          productData: 1,
        },
      },
      {
        $project: {
          totalOrders: 1,
          rows: {
            $slice: [
              {
                $sortArray: {
                  input: "$productData",
                  sortBy: finalSort,
                },
              },
              skip,
              limit,
            ],
          },
          totalProducts: { $size: "$productData" },
          totalQty: {
            $sum: {
              $map: {
                input: "$productData",
                as: "row",
                in: { $ifNull: ["$$row.qty", 0] },
              },
            },
          },
        },
      },
    ];

    const [result] = await Order.aggregate(pipeline).allowDiskUse(true);

    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const total = Number(result?.totalProducts || 0);
    const totalQty = Number(result?.totalQty || 0);
    const totalOrders = Number(result?.totalOrders || 0);

    return res.status(200).json({
      success: true,
      filters: {
        month: monthRange ? month : "",
        search,
        sort,
        page,
        limit,
      },
      summary: {
        totalProducts: total,
        totalQty,
        totalOrders,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
      rows,
    });
  } catch (error) {
    console.error("getProductSalesReport error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch product sales report",
    });
  }
};

/* =========================================================
   ORDER BUSINESS OVERVIEW
========================================================= */

export const getOrderBusinessOverview = async (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    const { match, monthRange } = buildConfirmedBusinessMatch(month);

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: null,
          totalOrdersReceived: { $sum: 1 },
          totalRevenueGenerated: {
            $sum: { $ifNull: ["$finalPayable", 0] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalOrdersReceived: { $ifNull: ["$totalOrdersReceived", 0] },
          totalRevenueGenerated: {
            $round: [{ $ifNull: ["$totalRevenueGenerated", 0] }, 2],
          },
          averageOrderValue: {
            $round: [
              {
                $cond: [
                  { $gt: [{ $ifNull: ["$totalOrdersReceived", 0] }, 0] },
                  {
                    $divide: [
                      { $ifNull: ["$totalRevenueGenerated", 0] },
                      { $ifNull: ["$totalOrdersReceived", 0] },
                    ],
                  },
                  0,
                ],
              },
              2,
            ],
          },
        },
      },
    ];

    const [result] = await Order.aggregate(pipeline).allowDiskUse(true);

    const summary = {
      totalOrdersReceived: Number(result?.totalOrdersReceived || 0),
      totalRevenueGenerated: Number(result?.totalRevenueGenerated || 0),
      averageOrderValue: Number(result?.averageOrderValue || 0),
    };

    return res.status(200).json({
      success: true,
      filters: {
        month: monthRange ? month : "",
      },
      summary,
    });
  } catch (error) {
    console.error("getOrderBusinessOverview error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch order business overview",
    });
  }
};

/* =========================================================
   ROAS REPORT
   Query params:
   - from=YYYY-MM-DD
   - to=YYYY-MM-DD
   - source=<optional spend source>
========================================================= */

export const getROASReport = async (req, res) => {
  try {
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const source = String(req.query.source || "").trim();

    const normalizedRange = buildDateRangeFromQuery({ from, to });

    const orderMatch = buildOrderRangeMatch({ from, to });
    const spendMatch = buildSpendRangeMatch({ from, to, source });

    const ordersAggPromise = Order.aggregate([
      ...(Object.keys(orderMatch).length ? [{ $match: orderMatch }] : []),
      {
        $project: {
          orderDateValue: buildOrderDateExpr(),
          revenue: buildOrderRevenueExpr(),
          isExcluded: buildOrderExcludedExpr(),
        },
      },
      {
        $project: {
          revenue: { $ifNull: ["$revenue", 0] },
          isExcluded: 1,
          ymd: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$orderDateValue",
              timezone: IST_TZ,
            },
          },
        },
      },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                revenueAll: { $sum: "$revenue" },
                revenueValid: {
                  $sum: {
                    $cond: [{ $eq: ["$isExcluded", false] }, "$revenue", 0],
                  },
                },
                ordersAll: { $sum: 1 },
                ordersValid: {
                  $sum: {
                    $cond: [{ $eq: ["$isExcluded", false] }, 1, 0],
                  },
                },
              },
            },
          ],
          dayWise: [
            {
              $group: {
                _id: "$ymd",
                revenueAll: { $sum: "$revenue" },
                revenueValid: {
                  $sum: {
                    $cond: [{ $eq: ["$isExcluded", false] }, "$revenue", 0],
                  },
                },
                ordersAll: { $sum: 1 },
                ordersValid: {
                  $sum: {
                    $cond: [{ $eq: ["$isExcluded", false] }, 1, 0],
                  },
                },
              },
            },
            {
              $project: {
                _id: 0,
                ymd: "$_id",
                revenueAll: { $round: [{ $ifNull: ["$revenueAll", 0] }, 2] },
                revenueValid: { $round: [{ $ifNull: ["$revenueValid", 0] }, 2] },
                ordersAll: { $ifNull: ["$ordersAll", 0] },
                ordersValid: { $ifNull: ["$ordersValid", 0] },
                aovAll: {
                  $round: [
                    {
                      $cond: [
                        { $gt: [{ $ifNull: ["$ordersAll", 0] }, 0] },
                        {
                          $divide: [
                            { $ifNull: ["$revenueAll", 0] },
                            { $ifNull: ["$ordersAll", 0] },
                          ],
                        },
                        0,
                      ],
                    },
                    2,
                  ],
                },
                aovValid: {
                  $round: [
                    {
                      $cond: [
                        { $gt: [{ $ifNull: ["$ordersValid", 0] }, 0] },
                        {
                          $divide: [
                            { $ifNull: ["$revenueValid", 0] },
                            { $ifNull: ["$ordersValid", 0] },
                          ],
                        },
                        0,
                      ],
                    },
                    2,
                  ],
                },
              },
            },
            { $sort: { ymd: -1 } },
          ],
        },
      },
    ]).allowDiskUse(true);

    const spendsAggPromise = MarketingSpend.aggregate([
      ...(Object.keys(spendMatch).length ? [{ $match: spendMatch }] : []),
      {
        $project: {
          source: {
            $trim: {
              input: {
                $toString: { $ifNull: ["$source", ""] },
              },
            },
          },
          spend: {
            $ifNull: [
              "$amount",
              {
                $ifNull: [
                  "$spend",
                  {
                    $ifNull: [
                      "$cost",
                      {
                        $ifNull: ["$value", "$total"],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          spendDateValue: {
            $ifNull: [
              "$spentAt",
              {
                $ifNull: ["$date", { $ifNull: ["$createdAt", "$updatedAt"] }],
              },
            ],
          },
        },
      },
      {
        $project: {
          source: 1,
          spend: { $ifNull: ["$spend", 0] },
          ymd: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$spendDateValue",
              timezone: IST_TZ,
            },
          },
        },
      },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                spendTotal: { $sum: "$spend" },
                spendCount: { $sum: 1 },
              },
            },
          ],
          dayWise: [
            {
              $group: {
                _id: "$ymd",
                spend: { $sum: "$spend" },
                entries: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                ymd: "$_id",
                spend: { $round: [{ $ifNull: ["$spend", 0] }, 2] },
                entries: { $ifNull: ["$entries", 0] },
              },
            },
            { $sort: { ymd: -1 } },
          ],
          sources: [
            {
              $match: {
                source: { $ne: "" },
              },
            },
            {
              $group: {
                _id: "$source",
              },
            },
            { $sort: { _id: 1 } },
            {
              $project: {
                _id: 0,
                value: "$_id",
              },
            },
          ],
        },
      },
    ]).allowDiskUse(true);

    const [ordersAgg, spendsAgg] = await Promise.all([
      ordersAggPromise,
      spendsAggPromise,
    ]);

    const orderSummary = ordersAgg?.[0]?.summary?.[0] || {};
    const orderDayWise = Array.isArray(ordersAgg?.[0]?.dayWise)
      ? ordersAgg[0].dayWise
      : [];

    const spendSummary = spendsAgg?.[0]?.summary?.[0] || {};
    const spendDayWise = Array.isArray(spendsAgg?.[0]?.dayWise)
      ? spendsAgg[0].dayWise
      : [];
    const sources = Array.isArray(spendsAgg?.[0]?.sources)
      ? spendsAgg[0].sources.map((x) => x.value).filter(Boolean)
      : [];

    const dayMap = new Map();

    for (const row of spendDayWise) {
      dayMap.set(row.ymd, {
        ymd: row.ymd,
        spend: toNum(row.spend),
        entries: toInt(row.entries),
        revenueAll: 0,
        revenueValid: 0,
        ordersAll: 0,
        ordersValid: 0,
        aovAll: 0,
        aovValid: 0,
      });
    }

    for (const row of orderDayWise) {
      const prev = dayMap.get(row.ymd) || {
        ymd: row.ymd,
        spend: 0,
        entries: 0,
        revenueAll: 0,
        revenueValid: 0,
        ordersAll: 0,
        ordersValid: 0,
        aovAll: 0,
        aovValid: 0,
      };

      prev.revenueAll = toNum(row.revenueAll);
      prev.revenueValid = toNum(row.revenueValid);
      prev.ordersAll = toInt(row.ordersAll);
      prev.ordersValid = toInt(row.ordersValid);
      prev.aovAll = toNum(row.aovAll);
      prev.aovValid = toNum(row.aovValid);

      dayMap.set(row.ymd, prev);
    }

    const dayWise = Array.from(dayMap.values())
      .sort((a, b) => (a.ymd < b.ymd ? 1 : -1))
      .map((r) => ({
        ymd: r.ymd,
        spend: Number(r.spend.toFixed(2)),
        entries: r.entries,
        revenueAll: Number(r.revenueAll.toFixed(2)),
        revenueValid: Number(r.revenueValid.toFixed(2)),
        ordersAll: r.ordersAll,
        ordersValid: r.ordersValid,
        aovAll: Number(toNum(r.aovAll).toFixed(2)),
        aovValid: Number(toNum(r.aovValid).toFixed(2)),
        roasAll: r.spend > 0 ? Number((r.revenueAll / r.spend).toFixed(2)) : 0,
        roasValid:
          r.spend > 0 ? Number((r.revenueValid / r.spend).toFixed(2)) : 0,
      }));

    const spendTotal = toNum(spendSummary?.spendTotal);
    const revenueAll = toNum(orderSummary?.revenueAll);
    const revenueValid = toNum(orderSummary?.revenueValid);
    const ordersAll = toInt(orderSummary?.ordersAll);
    const ordersValid = toInt(orderSummary?.ordersValid);

    const aovAll =
      ordersAll > 0 ? Number((revenueAll / ordersAll).toFixed(2)) : 0;

    const aovValid =
      ordersValid > 0 ? Number((revenueValid / ordersValid).toFixed(2)) : 0;

    return res.status(200).json({
      success: true,
      filters: {
        from: normalizedRange.from,
        to: normalizedRange.to,
        source,
      },
      summary: {
        spendTotal: Number(spendTotal.toFixed(2)),
        revenueAll: Number(revenueAll.toFixed(2)),
        revenueValid: Number(revenueValid.toFixed(2)),
        ordersAll,
        ordersValid,
        aovAll,
        aovValid,
        roasAll: spendTotal > 0 ? Number((revenueAll / spendTotal).toFixed(2)) : 0,
        roasValid:
          spendTotal > 0 ? Number((revenueValid / spendTotal).toFixed(2)) : 0,
      },
      sources,
      dayWise,
      spendDayWise: spendDayWise.map((r) => ({
        ymd: r.ymd,
        spend: toNum(r.spend),
        entries: toInt(r.entries),
      })),
    });
  } catch (error) {
    console.error("getROASReport error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch ROAS report",
    });
  }
};

export default {
  getProductSalesReport,
  getOrderBusinessOverview,
  getROASReport,
};