// Orders/orderReportsController.js
import Product from "../Products/Products.js";
import Order from "./Orders.js";
import MarketingSpend from "../MarketingSpend/marketingSpend.js"; // path adjust if needed

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


const startOfIstDayUtc = (date = new Date()) => {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

  return new Date(`${ymd}T00:00:00.000+05:30`);
};

const addDaysUtc = (date, days = 0) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const buildOperationsRangeFromQuery = ({
  range = "",
  from = "",
  to = "",
} = {}) => {
  const preset = String(range || "").trim().toLowerCase();
  const customRange = buildDateRangeFromQuery({ from, to });

  if (preset === "custom") {
    return {
      key: "custom",
      from: customRange.from,
      to: customRange.to,
      startUtc: customRange.startUtc,
      endUtc: customRange.endUtc,
    };
  }

  const todayStartUtc = startOfIstDayUtc(new Date());

  if (preset === "weekly") {
    const jsDay = new Intl.DateTimeFormat("en-US", {
      timeZone: IST_TZ,
      weekday: "short",
    }).format(new Date());

    const dayMap = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    const dayIndex = dayMap[jsDay] ?? 1;
    const diffToMonday = dayIndex === 0 ? 6 : dayIndex - 1;

    const startUtc = addDaysUtc(todayStartUtc, -diffToMonday);
    const endUtc = addDaysUtc(startUtc, 7);

    return {
      key: "weekly",
      from: "",
      to: "",
      startUtc,
      endUtc,
    };
  }

  if (preset === "month" || preset === "monthly") {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: IST_TZ,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());

    const year = Number(parts.find((p) => p.type === "year")?.value || 0);
    const month = Number(parts.find((p) => p.type === "month")?.value || 0);

    const startUtc = new Date(
      `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01T00:00:00.000+05:30`
    );

    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;

    const endUtc = new Date(
      `${String(endYear).padStart(4, "0")}-${String(endMonth).padStart(2, "0")}-01T00:00:00.000+05:30`
    );

    return {
      key: "month",
      from: "",
      to: "",
      startUtc,
      endUtc,
    };
  }

  const presetDaysMap = {
    last7: 7,
    "7d": 7,
    last15: 15,
    "15d": 15,
    last30: 30,
    "30d": 30,
  };

  const days = presetDaysMap[preset];

  if (days) {
    const startUtc = addDaysUtc(todayStartUtc, -(days - 1));
    const endUtc = addDaysUtc(todayStartUtc, 1);

    return {
      key: preset,
      from: "",
      to: "",
      startUtc,
      endUtc,
    };
  }

  return {
    key: "",
    from: customRange.from,
    to: customRange.to,
    startUtc: customRange.startUtc,
    endUtc: customRange.endUtc,
  };
};

const buildOperationsReportMatch = ({ range = "", from = "", to = "" }) => {
  const normalized = buildOperationsRangeFromQuery({ range, from, to });
  const dateExpr = buildOrderDateExpr();

  const and = [
    { orderType: { $ne: "parent" } },
  ];

  if (normalized.startUtc) {
    and.push({
      $expr: {
        $gte: [dateExpr, normalized.startUtc],
      },
    });
  }

  if (normalized.endUtc) {
    and.push({
      $expr: {
        $lt: [dateExpr, normalized.endUtc],
      },
    });
  }

  return {
    normalized,
    match: and.length ? { $and: and } : {},
  };
};


const parseList = (value = "") =>
  String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

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
      qty_desc: { totalQtySold: -1, productName: 1 },
      qty_asc: { totalQtySold: 1, productName: 1 },
      name_asc: { productName: 1, totalQtySold: -1 },
      name_desc: { productName: -1, totalQtySold: -1 },
      revenue_desc: {
        totalRevenue: -1,
        totalQtySold: -1,
        productName: 1,
      },
      revenue_asc: {
        totalRevenue: 1,
        totalQtySold: -1,
        productName: 1,
      },
      price_desc: {
        avgSellingPrice: -1,
        totalQtySold: -1,
        productName: 1,
      },
      price_asc: {
        avgSellingPrice: 1,
        totalQtySold: -1,
        productName: 1,
      },
      code_asc: { productCode: 1, totalQtySold: -1 },
      code_desc: { productCode: -1, totalQtySold: -1 },
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

          productRows: [
            {
              $project: {
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
                        $ifNull: [
                          "$items.productSnapshot.productCode",
                          "",
                        ],
                      },
                    },
                  },
                },

                productName: {
                  $trim: {
                    input: {
                      $toString: {
                        $ifNull: [
                          "$items.productSnapshot.title",
                          "",
                        ],
                      },
                    },
                  },
                },

                productImage: {
                  $let: {
                    vars: {
                      thumb: {
                        $ifNull: [
                          "$items.productSnapshot.thumbnail",
                          "",
                        ],
                      },
                      firstImage: {
                        $arrayElemAt: [
                          {
                            $ifNull: [
                              "$items.productSnapshot.images",
                              [],
                            ],
                          },
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

                // ✅ SIZE
                selectedSize: {
                  $trim: {
                    input: {
                      $toString: {
                        $ifNull: ["$items.selectedSize", ""],
                      },
                    },
                  },
                },

                quantity: {
                  $ifNull: ["$items.quantity", 0],
                },

                price: {
                  $ifNull: ["$items.price", 0],
                },

                subtotal: {
                  $cond: [
                    {
                      $gt: [
                        {
                          $ifNull: [
                            "$items.subtotal",
                            0,
                          ],
                        },
                        0,
                      ],
                    },
                    {
                      $ifNull: [
                        "$items.subtotal",
                        0,
                      ],
                    },
                    {
                      $multiply: [
                        {
                          $ifNull: [
                            "$items.price",
                            0,
                          ],
                        },
                        {
                          $ifNull: [
                            "$items.quantity",
                            0,
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },

            {
              $match: {
                quantity: { $gt: 0 },
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
                          $regex:
                            escapeRegex(search),
                          $options: "i",
                        },
                      },
                      {
                        productName: {
                          $regex:
                            escapeRegex(search),
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

                productCode: {
                  $first: "$productCode",
                },

                productId: {
                  $first: "$productId",
                },

                variantId: {
                  $first: "$variantId",
                },

                productName: {
                  $first: "$productName",
                },

                productImage: {
                  $first: "$productImage",
                },

                totalQtySold: {
                  $sum: "$quantity",
                },

                totalRevenue: {
                  $sum: "$subtotal",
                },

                priceQtyValue: {
                  $sum: {
                    $multiply: [
                      "$price",
                      "$quantity",
                    ],
                  },
                },

                // ✅ collect size + quantity
                sizeRows: {
                  $push: {
                    size: "$selectedSize",
                    quantity: "$quantity",
                  },
                },

                names: {
                  $addToSet: "$productName",
                },

                images: {
                  $addToSet: "$productImage",
                },
              },
            },

            {
              $project: {
                _id: 0,

                productId: 1,
                variantId: 1,
                productCode: 1,

                productName: {
                  $cond: [
                    {
                      $ne: [
                        "$productName",
                        "",
                      ],
                    },
                    "$productName",
                    {
                      $ifNull: [
                        {
                          $arrayElemAt: [
                            "$names",
                            0,
                          ],
                        },
                        "",
                      ],
                    },
                  ],
                },

                productImage: {
                  $cond: [
                    {
                      $ne: [
                        "$productImage",
                        "",
                      ],
                    },
                    "$productImage",
                    {
                      $ifNull: [
                        {
                          $arrayElemAt: [
                            "$images",
                            0,
                          ],
                        },
                        "",
                      ],
                    },
                  ],
                },

                totalQtySold: {
                  $ifNull: [
                    "$totalQtySold",
                    0,
                  ],
                },

                totalRevenue: {
                  $round: [
                    {
                      $ifNull: [
                        "$totalRevenue",
                        0,
                      ],
                    },
                    2,
                  ],
                },

                avgSellingPrice: {
                  $round: [
                    {
                      $cond: [
                        {
                          $gt: [
                            "$totalQtySold",
                            0,
                          ],
                        },
                        {
                          $divide: [
                            "$priceQtyValue",
                            "$totalQtySold",
                          ],
                        },
                        0,
                      ],
                    },
                    2,
                  ],
                },

                // ✅ send raw size rows
                sizeRows: 1,
              },
            },
          ],
        },
      },

      {
        $project: {
          totalOrders: {
            $ifNull: [
              {
                $arrayElemAt: [
                  "$orderStats.totalOrders",
                  0,
                ],
              },
              0,
            ],
          },

          productRows: 1,
        },
      },

      {
        $project: {
          totalOrders: 1,

          totalProducts: {
            $size: "$productRows",
          },

          totalQtySold: {
            $sum: {
              $map: {
                input: "$productRows",
                as: "row",
                in: {
                  $ifNull: [
                    "$$row.totalQtySold",
                    0,
                  ],
                },
              },
            },
          },

          totalRevenue: {
            $sum: {
              $map: {
                input: "$productRows",
                as: "row",
                in: {
                  $ifNull: [
                    "$$row.totalRevenue",
                    0,
                  ],
                },
              },
            },
          },

          rows: {
            $slice: [
              {
                $sortArray: {
                  input: "$productRows",
                  sortBy: finalSort,
                },
              },
              skip,
              limit,
            ],
          },
        },
      },
    ];

    const [result] = await Order.aggregate(
      pipeline
    ).allowDiskUse(true);

    // ✅ Merge duplicate sizes
    const rows = (
      Array.isArray(result?.rows)
        ? result.rows
        : []
    ).map((row) => {
      const sizeMap = {};

      for (const item of row.sizeRows || []) {
        const size = String(
          item?.size || ""
        )
          .trim()
          .toUpperCase();

        if (!size) continue;

        sizeMap[size] =
          (sizeMap[size] || 0) +
          Number(item?.quantity || 0);
      }

      const sizeOrder = [
        "XS",
        "S",
        "M",
        "L",
        "XL",
        "XXL",
        "3XL",
        "4XL",
        "5XL",
        "FREE",
      ];

      const sizes = Object.entries(sizeMap)
        .map(([size, quantity]) => ({
          size,
          quantity,
        }))
        .sort((a, b) => {
          const ai = sizeOrder.indexOf(a.size);
          const bi = sizeOrder.indexOf(b.size);

          if (ai === -1 && bi === -1)
            return a.size.localeCompare(b.size);

          if (ai === -1) return 1;
          if (bi === -1) return -1;

          return ai - bi;
        });

      const { sizeRows, ...cleanRow } = row;

      return {
        ...cleanRow,
        sizes,
      };
    });

    const total = Number(
      result?.totalProducts || 0
    );

    const totalQtySold = Number(
      result?.totalQtySold || 0
    );

    const totalRevenue = Number(
      result?.totalRevenue || 0
    );

    const totalOrders = Number(
      result?.totalOrders || 0
    );

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
        totalQtySold,
        totalRevenue: Number(
          totalRevenue.toFixed(2)
        ),
        totalOrders,
      },

      pagination: {
        page,
        limit,
        total,
        totalPages:
          total > 0
            ? Math.ceil(total / limit)
            : 0,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },

      rows,
    });
  } catch (error) {
    console.error(
      "getProductSalesReport error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Failed to fetch product sales report",
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


export const getOperationsStatusReport = async (req, res) => {
  try {
    const range = String(req.query.range || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();

    const { normalized, match } = buildOperationsReportMatch({
      range,
      from,
      to,
    });

    const pipeline = [
      ...(Object.keys(match).length ? [{ $match: match }] : []),
      {
        $facet: {
          counts: [
            {
              $group: {
                _id: null,
                totalOrders: { $sum: 1 },

                pendingProcessing: {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          { $toLower: { $ifNull: ["$fulfillmentStatus", ""] } },
                          "processing",
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },

                dispatched: {
                  $sum: {
                    $cond: [
                      {
                        $in: [
                          { $toLower: { $ifNull: ["$fulfillmentStatus", ""] } },
                          ["shipped", "out_for_delivery"],
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },

                delivered: {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          { $toLower: { $ifNull: ["$fulfillmentStatus", ""] } },
                          "delivered",
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },

                cancelled: {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          { $toLower: { $ifNull: ["$fulfillmentStatus", ""] } },
                          "cancelled",
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },

                returnedRto: {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          { $toLower: { $ifNull: ["$fulfillmentStatus", ""] } },
                          "rto",
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },

                refundsProcessed: {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          { $toLower: { $ifNull: ["$paymentStatus", ""] } },
                          "refunded",
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
            {
              $project: {
                _id: 0,
                totalOrders: { $ifNull: ["$totalOrders", 0] },
                pendingProcessing: { $ifNull: ["$pendingProcessing", 0] },
                dispatched: { $ifNull: ["$dispatched", 0] },
                delivered: { $ifNull: ["$delivered", 0] },
                cancelled: { $ifNull: ["$cancelled", 0] },
                returnedRto: { $ifNull: ["$returnedRto", 0] },
                refundsProcessed: { $ifNull: ["$refundsProcessed", 0] },
              },
            },
          ],
        },
      },
    ];

    const [result] = await Order.aggregate(pipeline).allowDiskUse(true);

    const summary = result?.counts?.[0] || {
      totalOrders: 0,
      pendingProcessing: 0,
      dispatched: 0,
      delivered: 0,
      cancelled: 0,
      returnedRto: 0,
      refundsProcessed: 0,
    };

    return res.status(200).json({
      success: true,
      filters: {
        range: normalized.key || "",
        from: normalized.from || "",
        to: normalized.to || "",
      },
      summary,
    });
  } catch (error) {
    console.error("getOperationsStatusReport error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch operations status report",
    });
  }
};


export const getUnsoldProducts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const search = String(req.query.search || "").trim();

    /* ---------------------------------------------------
       STEP 1: Get all sold productCodes from orders
    --------------------------------------------------- */
    const soldCodesAgg = await Order.aggregate([
      { $match: { "items.0": { $exists: true } } },
      { $unwind: "$items" },
      {
        $project: {
          productCode: {
            $trim: {
              input: {
                $toString: {
                  $ifNull: ["$items.productSnapshot.productCode", ""],
                },
              },
            },
          },
        },
      },
      {
        $match: {
          productCode: { $ne: "" },
        },
      },
      {
        $group: {
          _id: "$productCode",
        },
      },
    ]);

    const soldCodes = soldCodesAgg.map((x) => x._id);

    /* ---------------------------------------------------
       STEP 2: Find products NOT IN soldCodes
    --------------------------------------------------- */
    const match = {
      productCode: { $nin: soldCodes },
      isActive: true,
    };

    if (search) {
      match.$or = [
        { productCode: { $regex: search, $options: "i" } },
        { title: { $regex: search, $options: "i" } },
      ];
    }

    const [rows, total] = await Promise.all([
      Product.find(match)
        .select(
          "productCode title thumbnail price stock isInStock createdAt"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Product.countDocuments(match),
    ]);

    return res.status(200).json({
      success: true,
      filters: {
        search,
        page,
        limit,
      },
      summary: {
        totalUnsoldProducts: total,
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
    console.error("getUnsoldProducts error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch unsold products",
    });
  }
};


export const getFinalPayableByStatus = async (req, res) => {
  try {
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const fulfillmentStatus = String(req.query.fulfillmentStatus || "").trim();

    const dateMatch = buildOrderRangeMatch({ from, to });
    const statuses = parseList(fulfillmentStatus).map((s) => s.toLowerCase());

    const match = {
      orderType: { $ne: "parent" },
      ...(Object.keys(dateMatch).length ? dateMatch : {}),
    };

    if (statuses.length === 1) {
      match.fulfillmentStatus = statuses[0];
    } else if (statuses.length > 1) {
      match.fulfillmentStatus = { $in: statuses };
    }

    const normalizedRange = buildDateRangeFromQuery({ from, to });

    const pipeline = [
      { $match: match },
      {
        $project: {
          fulfillmentStatus: {
            $toLower: { $ifNull: ["$fulfillmentStatus", "unknown"] },
          },
          finalPayable: {
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
                                            $ifNull: ["$grandTotal", "$total"],
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
        },
      },
      {
        $facet: {
          breakdown: [
            {
              $group: {
                _id: "$fulfillmentStatus",
                totalOrders: { $sum: 1 },
                totalFinalPayable: { $sum: { $ifNull: ["$finalPayable", 0] } },
                avgFinalPayable: { $avg: { $ifNull: ["$finalPayable", 0] } },
              },
            },
            {
              $project: {
                _id: 0,
                fulfillmentStatus: "$_id",
                totalOrders: 1,
                totalFinalPayable: {
                  $round: [{ $ifNull: ["$totalFinalPayable", 0] }, 2],
                },
                avgFinalPayable: {
                  $round: [{ $ifNull: ["$avgFinalPayable", 0] }, 2],
                },
              },
            },
            { $sort: { fulfillmentStatus: 1 } },
          ],
          overall: [
            {
              $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                totalFinalPayable: { $sum: { $ifNull: ["$finalPayable", 0] } },
                avgFinalPayable: { $avg: { $ifNull: ["$finalPayable", 0] } },
              },
            },
            {
              $project: {
                _id: 0,
                totalOrders: { $ifNull: ["$totalOrders", 0] },
                totalFinalPayable: {
                  $round: [{ $ifNull: ["$totalFinalPayable", 0] }, 2],
                },
                avgFinalPayable: {
                  $round: [{ $ifNull: ["$avgFinalPayable", 0] }, 2],
                },
              },
            },
          ],
        },
      },
    ];

    const [result] = await Order.aggregate(pipeline).allowDiskUse(true);

    return res.status(200).json({
      success: true,
      filters: {
        from: normalizedRange.from,
        to: normalizedRange.to,
        fulfillmentStatus: statuses,
      },
      overall: result?.overall?.[0] || {
        totalOrders: 0,
        totalFinalPayable: 0,
        avgFinalPayable: 0,
      },
      breakdown: Array.isArray(result?.breakdown) ? result.breakdown : [],
    });
  } catch (error) {
    console.error("getFinalPayableByStatus error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch final payable by status",
    });
  }
};


export const getLowSellingProducts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const pipeline = [
      {
        $match: {
          isConfirmed: true,
          orderType: { $ne: "parent" },
          paymentStatus: { $nin: ["failed"] },
          fulfillmentStatus: { $nin: ["cancelled", "failed"] },
        },
      },

      { $project: { items: { $ifNull: ["$items", []] } } },
      { $unwind: "$items" },

      {
        $project: {
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
            $ifNull: ["$items.productSnapshot.thumbnail", ""],
          },
          quantity: { $ifNull: ["$items.quantity", 0] },
        },
      },

      {
        $match: {
          productCode: { $ne: "" },
          quantity: { $gt: 0 },
        },
      },

      {
        $group: {
          _id: "$productCode",
          productCode: { $first: "$productCode" },
          productName: { $first: "$productName" },
          productImage: { $first: "$productImage" },
          totalQtySold: { $sum: "$quantity" },
        },
      },

      // ✅ UPDATED
      {
        $match: {
          totalQtySold: { $gt: 0, $lte: 20 },
        },
      },

      { $sort: { totalQtySold: 1 } },

      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: "count" }],
        },
      },

      {
        $project: {
          rows: 1,
          total: {
            $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0],
          },
        },
      },
    ];

    const [result] = await Order.aggregate(pipeline);

    return res.status(200).json({
      success: true,
      pagination: {
        page,
        limit,
        total: result?.total || 0,
        totalPages: Math.ceil((result?.total || 0) / limit),
      },
      rows: result?.rows || [],
    });
  } catch (error) {
    console.error("getLowSellingProducts error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch low selling products",
    });
  }
};

export const getCancellationAnalyticsReport = async (req, res) => {
  try {
    const range = String(req.query.range || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();

    const { normalized, match: dateMatch } = buildOperationsReportMatch({
      range,
      from,
      to,
    });

    const match = {
      ...dateMatch,
      "cancellation.isCancelled": true,
      orderType: { $ne: "parent" },
    };

    const pipeline = [
      { $match: match },

      {
        $facet: {
          overview: [
            {
              $group: {
                _id: null,
                totalCancelledOrders: { $sum: 1 },
                totalCancelledRevenue: {
                  $sum: { $ifNull: ["$finalPayable", 0] },
                },
                avgCancelledOrderValue: {
                  $avg: { $ifNull: ["$finalPayable", 0] },
                },

                codCancelled: {
                  $sum: {
                    $cond: [{ $eq: ["$paymentMethod", "cod"] }, 1, 0],
                  },
                },

                prepaidCancelled: {
                  $sum: {
                    $cond: [{ $eq: ["$paymentMethod", "razorpay"] }, 1, 0],
                  },
                },

                confirmedCancelled: {
                  $sum: {
                    $cond: ["$isConfirmed", 1, 0],
                  },
                },

                unconfirmedCancelled: {
                  $sum: {
                    $cond: ["$isConfirmed", 0, 1],
                  },
                },

                refundPendingOrders: {
                  $sum: {
                    $cond: [
                      {
                        $in: [
                          { $toLower: { $ifNull: ["$paymentStatus", ""] } },
                          ["refund_pending"],
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
            {
              $project: {
                _id: 0,
                totalCancelledOrders: { $ifNull: ["$totalCancelledOrders", 0] },
                totalCancelledRevenue: {
                  $round: [{ $ifNull: ["$totalCancelledRevenue", 0] }, 2],
                },
                avgCancelledOrderValue: {
                  $round: [{ $ifNull: ["$avgCancelledOrderValue", 0] }, 2],
                },
                codCancelled: { $ifNull: ["$codCancelled", 0] },
                prepaidCancelled: { $ifNull: ["$prepaidCancelled", 0] },
                confirmedCancelled: { $ifNull: ["$confirmedCancelled", 0] },
                unconfirmedCancelled: { $ifNull: ["$unconfirmedCancelled", 0] },
                refundPendingOrders: { $ifNull: ["$refundPendingOrders", 0] },
              },
            },
          ],

          reasonBreakdown: [
            {
              $group: {
                _id: {
                  $trim: {
                    input: {
                      $toString: {
                        $ifNull: ["$cancellation.reason", "No reason"],
                      },
                    },
                  },
                },
                totalOrders: { $sum: 1 },
                revenue: { $sum: { $ifNull: ["$finalPayable", 0] } },
              },
            },
            {
              $project: {
                _id: 0,
                reason: {
                  $cond: [{ $eq: ["$_id", ""] }, "No reason", "$_id"],
                },
                totalOrders: 1,
                revenue: { $round: [{ $ifNull: ["$revenue", 0] }, 2] },
              },
            },
            { $sort: { totalOrders: -1 } },
          ],

          cancelledByBreakdown: [
            {
              $group: {
                _id: {
                  $ifNull: ["$cancellation.cancelledBy", "unknown"],
                },
                totalOrders: { $sum: 1 },
                revenue: { $sum: { $ifNull: ["$finalPayable", 0] } },
              },
            },
            {
              $project: {
                _id: 0,
                cancelledBy: "$_id",
                totalOrders: 1,
                revenue: { $round: [{ $ifNull: ["$revenue", 0] }, 2] },
              },
            },
            { $sort: { totalOrders: -1 } },
          ],

          paymentMethodBreakdown: [
            {
              $group: {
                _id: {
                  $ifNull: ["$paymentMethod", "unknown"],
                },
                totalOrders: { $sum: 1 },
                revenue: { $sum: { $ifNull: ["$finalPayable", 0] } },
              },
            },
            {
              $project: {
                _id: 0,
                paymentMethod: "$_id",
                totalOrders: 1,
                revenue: { $round: [{ $ifNull: ["$revenue", 0] }, 2] },
              },
            },
            { $sort: { totalOrders: -1 } },
          ],

          dailyTrend: [
            {
              $project: {
                ymd: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: {
                      $ifNull: ["$cancellation.cancelledAt", "$updatedAt"],
                    },
                    timezone: IST_TZ,
                  },
                },
                finalPayable: { $ifNull: ["$finalPayable", 0] },
              },
            },
            {
              $group: {
                _id: "$ymd",
                totalOrders: { $sum: 1 },
                revenue: { $sum: "$finalPayable" },
              },
            },
            {
              $project: {
                _id: 0,
                ymd: "$_id",
                totalOrders: 1,
                revenue: { $round: [{ $ifNull: ["$revenue", 0] }, 2] },
              },
            },
            { $sort: { ymd: 1 } },
          ],

          topCancelledProducts: [
            { $unwind: "$items" },
            {
              $project: {
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
                quantity: { $ifNull: ["$items.quantity", 0] },
                subtotal: {
                  $cond: [
                    { $gt: [{ $ifNull: ["$items.subtotal", 0] }, 0] },
                    { $ifNull: ["$items.subtotal", 0] },
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
                productCode: { $ne: "" },
                quantity: { $gt: 0 },
              },
            },
            {
              $group: {
                _id: "$productCode",
                productCode: { $first: "$productCode" },
                productName: { $first: "$productName" },
                productImage: { $first: "$productImage" },
                cancelledQty: { $sum: "$quantity" },
                cancelledRevenue: { $sum: "$subtotal" },
              },
            },
            {
              $project: {
                _id: 0,
                productCode: 1,
                productName: 1,
                productImage: 1,
                cancelledQty: 1,
                cancelledRevenue: {
                  $round: [{ $ifNull: ["$cancelledRevenue", 0] }, 2],
                },
              },
            },
            { $sort: { cancelledQty: -1 } },
            { $limit: 10 },
          ],
        },
      },
    ];

    const [result] = await Order.aggregate(pipeline).allowDiskUse(true);

    const totalOrdersMatch = {
      ...dateMatch,
      orderType: { $ne: "parent" },
    };

    const totalOrders = await Order.countDocuments(totalOrdersMatch);

    const overview = result?.overview?.[0] || {
      totalCancelledOrders: 0,
      totalCancelledRevenue: 0,
      avgCancelledOrderValue: 0,
      codCancelled: 0,
      prepaidCancelled: 0,
      confirmedCancelled: 0,
      unconfirmedCancelled: 0,
      refundPendingOrders: 0,
    };

    const cancellationRate =
      totalOrders > 0
        ? Number(((overview.totalCancelledOrders / totalOrders) * 100).toFixed(2))
        : 0;

    return res.status(200).json({
      success: true,
      filters: {
        range: normalized.key || "",
        from: normalized.from || "",
        to: normalized.to || "",
      },
      summary: {
        ...overview,
        totalOrders,
        cancellationRate,
      },
      reasonBreakdown: result?.reasonBreakdown || [],
      cancelledByBreakdown: result?.cancelledByBreakdown || [],
      paymentMethodBreakdown: result?.paymentMethodBreakdown || [],
      dailyTrend: result?.dailyTrend || [],
      topCancelledProducts: result?.topCancelledProducts || [],
    });
  } catch (error) {
    console.error("getCancellationAnalyticsReport error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch cancellation analytics report",
    });
  }
};



export default {
  getProductSalesReport,
  getOrderBusinessOverview,
  getROASReport,
  getOperationsStatusReport,
  getUnsoldProducts,
  getFinalPayableByStatus,
  getLowSellingProducts,
  getCancellationAnalyticsReport,
};
