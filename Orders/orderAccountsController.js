// Orders/orderAccountsController.js

import Order from "./Orders.js";
import { getStateCodeFromName } from "./stateCodeMap.js";

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
              "$shippingAddressSnapshot.fullName",
              "$billingAddressSnapshot.fullName",
              "$shippingAddress.fullName",
              "$shippingAddress.name",
              "$customer.name",
              "$customerName",
              {
                $trim: {
                  input: {
                    $concat: [
                      { $ifNull: ["$shippingAddressSnapshot.firstName", ""] },
                      " ",
                      { $ifNull: ["$shippingAddressSnapshot.lastName", ""] },
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
              $gt: [
                {
                  $strLenCP: {
                    $trim: {
                      input: { $ifNull: ["$$name", ""] },
                    },
                  },
                },
                0,
              ],
            },
          },
        },
      },
    },
    in: { $ifNull: ["$$firstNonEmpty", ""] },
  },
});

const getResolvedStateExpr = () => ({
  $let: {
    vars: {
      firstNonEmpty: {
        $first: {
          $filter: {
            input: [
              "$shippingAddressSnapshot.state",
              "$billingAddressSnapshot.state",
              "$shippingAddress.state",
              "$address.state",
              "$billingAddress.state",
            ],
            as: "state",
            cond: {
              $gt: [
                {
                  $strLenCP: {
                    $trim: {
                      input: { $ifNull: ["$$state", ""] },
                    },
                  },
                },
                0,
              ],
            },
          },
        },
      },
    },
    in: { $ifNull: ["$$firstNonEmpty", ""] },
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



const getLedgerCourierExpr = () => ({
  $let: {
    vars: {
      firstNonEmpty: {
        $first: {
          $filter: {
            input: [
              "$shipment.shiprocket.courierName",
              "$shipment.xpressbees.courierName",
              "$trackingDetails.courierName",
              "$shipment.courierName",
              "$shipment.awbData.courier_name",
              "$shipment.shiprocket.courier_name",
              "$courierName",
            ],
            as: "courier",
            cond: {
              $gt: [
                {
                  $strLenCP: {
                    $trim: {
                      input: { $ifNull: ["$$courier", ""] },
                    },
                  },
                },
                0,
              ],
            },
          },
        },
      },
    },
    in: { $ifNull: ["$$firstNonEmpty", ""] },
  },
});



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
   SALES LEDGER REPORT
   GET /api/orders/accounts/sales-ledger
========================================================= */

const buildSalesLedgerBasePipeline = ({ month, search, startDate, endDate }) => {
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
        orderDateResolved: {
          $ifNull: ["$orderDate", { $ifNull: ["$createdAt", "$updatedAt"] }],
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
        courierNameResolved: getLedgerCourierExpr(),
        orderDiscountResolved: { $toDouble: { $ifNull: ["$discount", 0] } },
        orderShippingResolved: { $toDouble: { $ifNull: ["$shippingFee", 0] } },
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
                            $max: [1, { $toDouble: { $ifNull: ["$$it.quantity", 1] } }],
                          },
                        ],
                      },
                    },
                  },
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
            "$items.productSnapshot.hsnCode",
            {
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
          ],
        },
        itemProductType: {
          $ifNull: [
            "$items.productSnapshot.productType",
            {
              $ifNull: ["$items.productModel", "Product"],
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
          $multiply: ["$itemQty", { $ifNull: ["$itemPriceIncl", 0] }],
        },
      },
    },
    {
      $addFields: {
        totalDiscount: {
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
        shippingCharges: {
          $cond: [
            { $gt: ["$orderSubtotalResolved", 0] },
            {
              $multiply: [
                { $divide: ["$itemGrossIncl", "$orderSubtotalResolved"] },
                "$orderShippingResolved",
              ],
            },
            0,
          ],
        },
      },
    },
    {
      $addFields: {
        netInclusive: {
          $max: [
            0,
            {
              $subtract: [
                { $add: ["$itemGrossIncl", "$shippingCharges"] },
                "$totalDiscount",
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        taxable: {
          $divide: ["$netInclusive", 1 + SALES_TAX_RATE],
        },
        taxAmount: {
          $subtract: [
            "$netInclusive",
            {
              $divide: ["$netInclusive", 1 + SALES_TAX_RATE],
            },
          ],
        },
        taxRate: { $literal: "5%" },
        paymentType: {
          $cond: [{ $eq: ["$paymentMethod", "cod"] }, "COD", "Prepaid"],
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
          { courierNameResolved: { $regex: rx, $options: "i" } },
          { itemProductType: { $regex: rx, $options: "i" } },
          { itemHsn: { $regex: rx, $options: "i" } },
          { itemSize: { $regex: rx, $options: "i" } },
          { paymentMethod: { $regex: rx, $options: "i" } },
        ],
      },
    });
  }

  return pipeline;
};

const buildSalesLedgerResponse = async ({
  month,
  search,
  startDate,
  endDate,
  page,
  limit,
}) => {
  const skip = (page - 1) * limit;
  const pipeline = buildSalesLedgerBasePipeline({
    month,
    search,
    startDate,
    endDate,
  });

  const [countAgg, rowsAgg, totalsAgg] = await Promise.all([
    Order.aggregate([...pipeline, { $count: "total" }]),

    Order.aggregate([
      ...pipeline,
      { $sort: { deliveredAtResolved: -1, orderDateResolved: -1, _id: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          orderId: "$orderNumber",
          orderDate: "$orderDateResolved",
          deliveredDate: "$deliveredAtResolved",
          customerName: { $ifNull: ["$customerNameResolved", ""] },
          state: { $ifNull: ["$customerStateResolved", ""] },
          paymentType: { $ifNull: ["$paymentType", ""] },
          courier: { $ifNull: ["$courierNameResolved", ""] },
          productType: { $ifNull: ["$itemProductType", "Product"] },
          hsnCode: { $ifNull: ["$itemHsn", DEFAULT_HSN] },
          size: { $ifNull: ["$itemSize", ""] },
          qty: { $ifNull: ["$itemQty", 1] },
          unitInclusiveTax: { $ifNull: ["$itemPriceIncl", 0] },
          totalDiscount: { $ifNull: ["$totalDiscount", 0] },
          netInclusive: { $ifNull: ["$netInclusive", 0] },
          taxable: { $ifNull: ["$taxable", 0] },
          shippingCharges: { $ifNull: ["$shippingCharges", 0] },
          taxAmount: { $ifNull: ["$taxAmount", 0] },
          taxRate: { $ifNull: ["$taxRate", "5%"] },
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
          totalDiscount: { $sum: { $ifNull: ["$totalDiscount", 0] } },
          netInclusive: { $sum: { $ifNull: ["$netInclusive", 0] } },
          taxable: { $sum: { $ifNull: ["$taxable", 0] } },
          shippingCharges: { $sum: { $ifNull: ["$shippingCharges", 0] } },
          taxAmount: { $sum: { $ifNull: ["$taxAmount", 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          rows: 1,
          orders: { $size: { $ifNull: ["$ordersSet", []] } },
          totalDiscount: 1,
          netInclusive: 1,
          taxable: 1,
          shippingCharges: 1,
          taxAmount: 1,
        },
      },
    ]),
  ]);

  const totalRows = toNum(countAgg?.[0]?.total, 0);
  const totalPages = Math.max(1, Math.ceil(totalRows / limit));
  const totalsDoc = totalsAgg?.[0] || {};

  const rows = Array.isArray(rowsAgg)
    ? rowsAgg.map((row) => ({
        ...row,
        qty: toNum(row?.qty, 0),
        unitInclusiveTax: money(row?.unitInclusiveTax),
        totalDiscount: money(row?.totalDiscount),
        netInclusive: money(row?.netInclusive),
        taxable: money(row?.taxable),
        shippingCharges: money(row?.shippingCharges),
        taxAmount: money(row?.taxAmount),
      }))
    : [];

  return {
    success: true,
    rows,
    totals: {
      rows: toNum(totalsDoc.rows, 0),
      orders: toNum(totalsDoc.orders, 0),
      totalDiscount: money(totalsDoc.totalDiscount),
      netInclusive: money(totalsDoc.netInclusive),
      taxable: money(totalsDoc.taxable),
      shippingCharges: money(totalsDoc.shippingCharges),
      taxAmount: money(totalsDoc.taxAmount),
    },
    meta: {
      page,
      limit,
      totalRows,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      month,
      search,
      startDate,
      endDate,
    },
  };
};

export const getSalesLedgerReport = async (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    const search = String(req.query.search || "").trim();
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();

    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(String(req.query.limit || "100"), 10) || 100)
    );

    const data = await buildSalesLedgerResponse({
      month,
      search,
      startDate,
      endDate,
      page,
      limit,
    });

    return res.status(200).json(data);
  } catch (error) {
    console.error("getSalesLedgerReport error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch sales ledger report",
      error: error?.message || "Server error",
    });
  }
};

export const downloadSalesLedgerCsv = async (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    const search = String(req.query.search || "").trim();
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();

    const data = await buildSalesLedgerResponse({
      month,
      search,
      startDate,
      endDate,
      page: 1,
      limit: MAX_LIMIT,
    });

    const rows = Array.isArray(data?.rows) ? data.rows : [];

    const header = [
      "Order ID",
      "Order Date",
      "Delivered Date",
      "Customer Name",
      "State",
      "Payment Type",
      "Courier",
      "Product Type",
      "HSN Code",
      "Size",
      "Qty",
      "Unit (Inclusive Tax)",
      "T. Discount",
      "Net (Inclusive)",
      "Taxable",
      "Shipping Charges",
      "Tax Amount",
      "Tax Rate",
    ];

    const escapeCsv = (value) => {
      const str = String(value ?? "");
      return `"${str.replace(/"/g, '""')}"`;
    };

    const csv = [
      header.join(","),
      ...rows.map((row) =>
        [
          row.orderId,
          row.orderDate,
          row.deliveredDate,
          row.customerName,
          row.state,
          row.paymentType,
          row.courier,
          row.productType,
          row.hsnCode,
          row.size,
          row.qty,
          row.unitInclusiveTax,
          row.totalDiscount,
          row.netInclusive,
          row.taxable,
          row.shippingCharges,
          row.taxAmount,
          row.taxRate,
        ]
          .map(escapeCsv)
          .join(",")
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=sales-ledger-${month || "all"}.csv`
    );

    return res.status(200).send(csv);
  } catch (error) {
    console.error("downloadSalesLedgerCsv error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to download sales ledger csv",
      error: error?.message || "Server error",
    });
  }
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



/* =========================================================
   GST REPORT (UPDATED - GROUP BY STATE CODE)
========================================================= */

export const getGSTReport = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(250, Math.max(1, Number(req.query.limit || 50)));
    const skip = (page - 1) * limit;

    const { month, search, startDate, endDate } = req.query;

    const base = buildSalesBasePipeline({
      month,
      search,
      startDate,
      endDate,
    });

    const pipeline = [
      ...base,

      /* -----------------------------
         NORMALIZE STATE
      ------------------------------ */
      {
        $addFields: {
          stateNormalized: {
            $toUpper: {
              $trim: {
                input: { $ifNull: ["$customerStateResolved", "UNKNOWN"] },
              },
            },
          },
        },
      },

      /* -----------------------------
         GROUP TEMP (by state name first)
      ------------------------------ */
      {
        $group: {
          _id: "$stateNormalized",
          taxableValue: { $sum: { $ifNull: ["$taxableValue", 0] } },
          taxAmount: { $sum: { $ifNull: ["$taxAmount", 0] } },
          orders: { $addToSet: "$orderNumber" },
        },
      },

      {
        $project: {
          _id: 0,
          stateName: "$_id",
          taxableValue: { $round: ["$taxableValue", 2] },
          taxAmount: { $round: ["$taxAmount", 2] },
          totalOrders: { $size: "$orders" },
        },
      },
    ];

    /* -----------------------------
       RUN AGG
    ------------------------------ */
    const rawRows = await Order.aggregate(pipeline);

    /* -----------------------------
       FINAL MERGE BY STATE CODE
    ------------------------------ */
    const map = {};

    rawRows.forEach((row) => {
      const code = getStateCodeFromName(row.stateName) || "NA";

      if (!map[code]) {
        map[code] = {
          stateCode: code,
          stateName: row.stateName,
          taxableValue: 0,
          taxAmount: 0,
          totalOrders: 0,
          taxRate: "5%",
        };
      }

      map[code].taxableValue += Number(row.taxableValue || 0);
      map[code].taxAmount += Number(row.taxAmount || 0);
      map[code].totalOrders += Number(row.totalOrders || 0);
    });

    const rowsAll = Object.values(map).map((r) => ({
      ...r,
      taxableValue: Number(r.taxableValue.toFixed(2)),
      taxAmount: Number(r.taxAmount.toFixed(2)),
    }));

    /* -----------------------------
       PAGINATION
    ------------------------------ */
    const total = rowsAll.length;
    const paginated = rowsAll.slice(skip, skip + limit);

    /* -----------------------------
       SUMMARY
    ------------------------------ */
    const summary = rowsAll.reduce(
      (acc, row) => {
        acc.taxableValue += row.taxableValue;
        acc.taxAmount += row.taxAmount;
        acc.totalOrders += row.totalOrders;
        return acc;
      },
      {
        taxableValue: 0,
        taxAmount: 0,
        totalOrders: 0,
        totalStates: rowsAll.length,
        taxRate: "5%",
      }
    );

    return res.json({
      success: true,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
      summary: {
        ...summary,
        taxableValue: Number(summary.taxableValue.toFixed(2)),
        taxAmount: Number(summary.taxAmount.toFixed(2)),
      },
      rows: paginated,
    });
  } catch (err) {
    console.error("GST REPORT ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch GST report",
    });
  }
};

