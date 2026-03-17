// Orders/orderAccountsController.js

import Order from "./Orders.js";

const IST = "Asia/Kolkata";
const MAX_LIMIT = 250;
const DEFAULT_HSN = "62105000";
const SALES_TAX_RATE = 0.05;

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const money = (n) =>
  Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

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

/* =========================================================
   SHARED / REVENUE BASE
========================================================= */
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
          $ifNull: ["$createdAt", { $ifNull: ["$orderDate", "$updatedAt"] }],
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
    const rx = escapeRegex(search);
    pipeline.push({
      $match: {
        $or: [
          { orderNumber: { $regex: rx, $options: "i" } },
          { "customer.name": { $regex: rx, $options: "i" } },
          { customerName: { $regex: rx, $options: "i" } },
          { "shippingAddress.state": { $regex: rx, $options: "i" } },
          { "address.state": { $regex: rx, $options: "i" } },
          { couponCode: { $regex: rx, $options: "i" } },
          { "coupon.code": { $regex: rx, $options: "i" } },
          { paymentMethod: { $regex: rx, $options: "i" } },
          { fulfillmentStatus: { $regex: rx, $options: "i" } },
        ],
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
   SALES REPORT HELPERS
========================================================= */

const getResolvedCustomerNameExpr = () => ({
  $let: {
    vars: {
      firstNonEmpty: {
        $first: {
          $filter: {
            input: [
              "$shippingAddress.fullName",
              "$shippingAddress.name",
              "$customer.name",
              "$customerName",
              {
                $trim: {
                  input: {
                    $concat: [
                      { $ifNull: ["$shippingAddress.firstName", ""] },
                      " ",
                      { $ifNull: ["$shippingAddress.lastName", ""] },
                    ],
                  },
                },
              },
              {
                $trim: {
                  input: {
                    $concat: [
                      { $ifNull: ["$customer.firstName", ""] },
                      " ",
                      { $ifNull: ["$customer.lastName", ""] },
                    ],
                  },
                },
              },
            ],
            as: "name",
            cond: {
              $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ["$$name", ""] } } } }, 0],
            },
          },
        },
      },
    },
    in: "$$firstNonEmpty",
  },
});

const getResolvedStateExpr = () => ({
  $let: {
    vars: {
      firstNonEmpty: {
        $first: {
          $filter: {
            input: [
              "$shippingAddress.state",
              "$address.state",
              "$billingAddress.state",
            ],
            as: "state",
            cond: {
              $gt: [
                { $strLenCP: { $trim: { input: { $ifNull: ["$$state", ""] } } } },
                0,
              ],
            },
          },
        },
      },
    },
    in: "$$firstNonEmpty",
  },
});

const getResolvedCouponExpr = () => ({
  $let: {
    vars: {
      firstNonEmpty: {
        $first: {
          $filter: {
            input: [
              "$couponCode",
              "$coupon.code",
              "$appliedCoupon.code",
            ],
            as: "coupon",
            cond: {
              $gt: [
                { $strLenCP: { $trim: { input: { $ifNull: ["$$coupon", ""] } } } },
                0,
              ],
            },
          },
        },
      },
    },
    in: "$$firstNonEmpty",
  },
});

const buildSalesBasePipeline = ({ month, search, startDate, endDate }) => {
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
      },
    },
    {
      $match: {
        paymentMethod: { $ne: "exchange" },
        paymentStatus: { $nin: ["failed", "refunded", "refund_pending"] },
        fulfillmentStatus: "delivered",
        deliveredAtResolved: { $ne: null },
      },
    },
  ];

  if (month) {
    const range = getMonthRangeUTCFromISTMonth(month);
    if (range) {
      pipeline.push({
        $match: {
          deliveredAtResolved: { $gte: range.startUTC, $lt: range.endUTC },
        },
      });
    }
  }

  if (startDate || endDate) {
    const deliveredDateMatch = {};
    if (startDate) deliveredDateMatch.$gte = new Date(`${startDate}T00:00:00.000Z`);
    if (endDate) deliveredDateMatch.$lte = new Date(`${endDate}T23:59:59.999Z`);

    pipeline.push({
      $match: { deliveredAtResolved: deliveredDateMatch },
    });
  }

  pipeline.push(
    {
      $addFields: {
        customerNameResolved: getResolvedCustomerNameExpr(),
        customerStateResolved: getResolvedStateExpr(),
        couponCodeResolved: getResolvedCouponExpr(),
        courierNameResolved: {
          $ifNull: [
            "$shipment.courierName",
            {
              $ifNull: [
                "$shipment.awbData.courier_name",
                {
                  $ifNull: [
                    "$shipment.shiprocket.courier_name",
                    {
                      $ifNull: ["$courierName", ""],
                    },
                  ],
                },
              ],
            },
          ],
        },

        orderDiscountResolved: { $ifNull: ["$discount", 0] },
        orderTotalResolved: { $ifNull: ["$finalPayable", 0] },

        orderSubtotalResolved: {
          $let: {
            vars: {
              itemsArray: {
                $cond: [{ $isArray: "$items" }, "$items", []],
              },
            },
            in: {
              $ifNull: [
                "$subtotal",
                {
                  $ifNull: [
                    "$subTotal",
                    {
                      $ifNull: [
                        "$cartTotal",
                        {
                          $sum: {
                            $map: {
                              input: "$$itemsArray",
                              as: "it",
                              in: {
                                $multiply: [
                                  {
                                    $toDouble: {
                                      $ifNull: [
                                        "$$it.finalPrice",
                                        {
                                          $ifNull: [
                                            "$$it.price",
                                            {
                                              $ifNull: [
                                                "$$it.sellingPrice",
                                                {
                                                  $ifNull: ["$$it.unitPrice", "$$it.mrp"],
                                                },
                                              ],
                                            },
                                          ],
                                        },
                                      ],
                                    },
                                  },
                                  {
                                    $max: [
                                      1,
                                      {
                                        $toDouble: {
                                          $ifNull: ["$$it.quantity", 1],
                                        },
                                      },
                                    ],
                                  },
                                ],
                              },
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },
    {
      $unwind: {
        path: "$items",
        preserveNullAndEmptyArrays: false,
      },
    },
    {
      $addFields: {
        itemQty: {
          $max: [1, { $toDouble: { $ifNull: ["$items.quantity", 1] } }],
        },
        itemSize: {
          $ifNull: [
            "$items.selectedSize",
            {
              $ifNull: ["$items.size", "$items.variant.size"],
            },
          ],
        },
        itemHsn: {
          $ifNull: [
            "$items.hsnCode",
            {
              $ifNull: [
                "$items.hsn",
                {
                  $ifNull: ["$items.taxInfo.hsnCode", DEFAULT_HSN],
                },
              ],
            },
          ],
        },
        itemProductType: {
          $ifNull: [
            "$items.productModel",
            {
              $ifNull: ["$items.productType", "Product"],
            },
          ],
        },
        itemPriceIncl: {
          $toDouble: {
            $ifNull: [
              "$items.finalPrice",
              {
                $ifNull: [
                  "$items.price",
                  {
                    $ifNull: [
                      "$items.sellingPrice",
                      {
                        $ifNull: ["$items.unitPrice", "$items.mrp"],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    },
    {
      $addFields: {
        itemGrossIncl: {
          $multiply: [{ $ifNull: ["$itemPriceIncl", 0] }, "$itemQty"],
        },
      },
    },
    {
      $addFields: {
        allocatedDiscount: {
          $cond: [
            { $gt: ["$orderSubtotalResolved", 0] },
            {
              $multiply: [
                { $divide: ["$itemGrossIncl", "$orderSubtotalResolved"] },
                "$orderDiscountResolved",
              ],
            },
            0,
          ],
        },
      },
    },
    {
      $addFields: {
        netLine: {
          $max: [0, { $subtract: ["$itemGrossIncl", "$allocatedDiscount"] }],
        },
      },
    },
    {
      $addFields: {
        taxableValue: {
          $divide: ["$netLine", 1 + SALES_TAX_RATE],
        },
        taxAmount: {
          $subtract: [
            "$netLine",
            {
              $divide: ["$netLine", 1 + SALES_TAX_RATE],
            },
          ],
        },
        deliveredMonth: {
          $dateToString: {
            format: "%Y-%m",
            date: "$deliveredAtResolved",
            timezone: IST,
          },
        },
      },
    }
  );

  if (search) {
    const rx = escapeRegex(search);
    pipeline.push({
      $match: {
        $or: [
          { orderNumber: { $regex: rx, $options: "i" } },
          { customerNameResolved: { $regex: rx, $options: "i" } },
          { customerStateResolved: { $regex: rx, $options: "i" } },
          { couponCodeResolved: { $regex: rx, $options: "i" } },
          { itemHsn: { $regex: rx, $options: "i" } },
          { itemSize: { $regex: rx, $options: "i" } },
          { itemProductType: { $regex: rx, $options: "i" } },
          { paymentMethod: { $regex: rx, $options: "i" } },
          { courierNameResolved: { $regex: rx, $options: "i" } },
        ],
      },
    });
  }

  return pipeline;
};

const buildSalesResponse = async ({
  month,
  search,
  startDate,
  endDate,
  page,
  limit,
}) => {
  const skip = (page - 1) * limit;
  const pipeline = buildSalesBasePipeline({ month, search, startDate, endDate });

  const [countAgg, rowsAgg, totalsAgg] = await Promise.all([
    Order.aggregate([...pipeline, { $count: "total" }]),

    Order.aggregate([
      ...pipeline,
      { $sort: { deliveredAtResolved: -1, _id: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          orderId: "$orderNumber",
          deliveredMonth: 1,
          customerName: { $ifNull: ["$customerNameResolved", ""] },
          customerState: { $ifNull: ["$customerStateResolved", ""] },
          paymentMode: {
            $cond: [{ $eq: ["$paymentMethod", "cod"] }, "COD", "Prepaid"],
          },
          paymentMethod: { $ifNull: ["$paymentMethod", ""] },
          courierName: { $ifNull: ["$courierNameResolved", ""] },
          productType: { $ifNull: ["$itemProductType", "Product"] },
          hsnCode: { $ifNull: ["$itemHsn", DEFAULT_HSN] },
          productSize: { $ifNull: ["$itemSize", ""] },
          qty: { $ifNull: ["$itemQty", 1] },
          sellingPrice: { $ifNull: ["$itemPriceIncl", 0] },
          allocatedDiscount: { $ifNull: ["$allocatedDiscount", 0] },
          netLine: { $ifNull: ["$netLine", 0] },
          taxableValue: { $ifNull: ["$taxableValue", 0] },
          taxAmount: { $ifNull: ["$taxAmount", 0] },
          taxRate: { $literal: "5%" },
          orderTotalAmount: { $ifNull: ["$orderTotalResolved", 0] },
          orderDiscount: { $ifNull: ["$orderDiscountResolved", 0] },
          couponCode: { $ifNull: ["$couponCodeResolved", ""] },
          deliveredAt: "$deliveredAtResolved",
        },
      },
    ]),

    Order.aggregate([
      ...pipeline,
      {
        $group: {
          _id: null,
          rows: { $sum: 1 },
          ordersSet: { $addToSet: "$_id" },
          disc: { $sum: { $ifNull: ["$allocatedDiscount", 0] } },
          net: { $sum: { $ifNull: ["$netLine", 0] } },
          taxable: { $sum: { $ifNull: ["$taxableValue", 0] } },
          tax: { $sum: { $ifNull: ["$taxAmount", 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          rows: 1,
          orders: { $size: { $ifNull: ["$ordersSet", []] } },
          disc: 1,
          net: 1,
          taxable: 1,
          tax: 1,
        },
      },
    ]),
  ]);

  const totalRows = toNum(countAgg?.[0]?.total, 0);
  const totalPages = Math.max(1, Math.ceil(totalRows / limit));

  const rows = Array.isArray(rowsAgg)
    ? rowsAgg.map((row) => ({
        ...row,
        qty: toNum(row.qty, 1),
        sellingPrice: money(row.sellingPrice),
        allocatedDiscount: money(row.allocatedDiscount),
        netLine: money(row.netLine),
        taxableValue: money(row.taxableValue),
        taxAmount: money(row.taxAmount),
        orderTotalAmount: money(row.orderTotalAmount),
        orderDiscount: money(row.orderDiscount),
        hsnCode: row.hsnCode || DEFAULT_HSN,
        taxRate: row.taxRate || "5%",
      }))
    : [];

  const totalsDoc = totalsAgg?.[0] || {};

  return {
    success: true,
    meta: {
      page,
      limit,
      totalOrders: toNum(totalsDoc.orders, 0),
      totalRows,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      month,
      search,
      startDate,
      endDate,
    },
    totals: {
      rows: toNum(totalsDoc.rows, 0),
      orders: toNum(totalsDoc.orders, 0),
      disc: money(totalsDoc.disc),
      net: money(totalsDoc.net),
      taxable: money(totalsDoc.taxable),
      tax: money(totalsDoc.tax),
    },
    rows,
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
   GET /api/orders/accounts/sales-report
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

    const data = await buildSalesResponse({
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