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

const getDeliveredAtExpr = () => ({
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
});

const getSalesStatusDateExpr = () => ({
  $switch: {
    branches: [
      {
        case: { $eq: ["$fulfillmentStatus", "delivered"] },
        then: {
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
                          $ifNull: [
                            "$statusTimestamps.deliveredAt",
                            "$deliveredAt",
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
      {
        case: { $eq: ["$fulfillmentStatus", "exchange_requested"] },
        then: {
          $ifNull: [
            "$statusTimestamps.exchangeRequestedAt",
            { $ifNull: ["$exchangeRequestedAt", "$updatedAt"] },
          ],
        },
      },
      {
        case: { $eq: ["$fulfillmentStatus", "exchanged"] },
        then: {
          $ifNull: [
            "$statusTimestamps.exchangedAt",
            { $ifNull: ["$exchangedAt", "$updatedAt"] },
          ],
        },
      },
    ],
    default: {
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
                      $ifNull: ["$statusTimestamps.deliveredAt", "$updatedAt"],
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

const ACTIVE_REVENUE_STATUSES = [
  "processing",
  "packed",
  "picked",
  "shipped",
  "out_for_delivery",
  "delivered",
];

const SALES_BOOKED_STATUSES = ["delivered", "exchange_requested", "exchanged"];

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
                          $ifNull: [
                            "$statusTimestamps.deliveredAt",
                            "$deliveredAt",
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
        revenueDateResolved: {
          $ifNull: ["$createdAt", { $ifNull: ["$orderDate", "$updatedAt"] }],
        },
      },
    },
    {
      $match: {
        isInfluencerOrder: { $ne: true },
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
    if (startDate)
      revenueDateMatch.$gte = new Date(`${startDate}T00:00:00.000Z`);
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
        toNum(summaryDoc.netRevenue, 0) + toNum(summaryDoc.totalDiscount, 0),
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
            input: ["$couponCode", "$coupon.code", "$appliedCoupon.code"],
            as: "coupon",
            cond: {
              $gt: [
                {
                  $strLenCP: {
                    $trim: { input: { $ifNull: ["$$coupon", ""] } },
                  },
                },
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

const buildSalesBasePipeline = ({
  month,
  search,
  startDate,
  endDate,
}) => {
  const pipeline = [
    {
      $addFields: {
        deliveredAtResolved:
          getDeliveredAtExpr(),

        salesStatusDateResolved:
          getSalesStatusDateExpr(),
      },
    },

    {
      $match: {
        isInfluencerOrder: { $ne: true },
        paymentMethod: {
          $ne: "exchange",
        },

        deliveredAtResolved: {
          $type: "date",
        },
      },
    },
  ];

  /* =========================================================
     DATE FILTERS
  ========================================================= */

  if (month) {
    const range =
      getMonthRangeUTCFromISTMonth(
        month
      );

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

  if (startDate || endDate) {
    const deliveredDateMatch = {};

    if (startDate) {
      deliveredDateMatch.$gte =
        new Date(
          `${startDate}T00:00:00.000Z`
        );
    }

    if (endDate) {
      deliveredDateMatch.$lte =
        new Date(
          `${endDate}T23:59:59.999Z`
        );
    }

    pipeline.push({
      $match: {
        deliveredAtResolved:
          deliveredDateMatch,
      },
    });
  }

  pipeline.push(
    /* =========================================================
       ORDER-LEVEL VALUES
    ========================================================= */

    {
      $addFields: {
        customerNameResolved:
          getResolvedCustomerNameExpr(),

        customerStateResolved:
          getResolvedStateExpr(),

        couponCodeResolved:
          getResolvedCouponExpr(),

        courierNameResolved: {
          $ifNull: [
            "$shipment.courierName",
            {
              $ifNull: [
                "$shipment.awbData.courier_name",
                {
                  $ifNull: [
                    "$shipment.shiprocket.courierName",
                    {
                      $ifNull: [
                        "$shipment.shiprocket.courier_name",
                        {
                          $ifNull: [
                            "$courierName",
                            "",
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

        orderDiscountResolved: {
          $toDouble: {
            $ifNull: [
              "$discount",
              0,
            ],
          },
        },

        orderTotalResolved: {
          $toDouble: {
            $ifNull: [
              "$finalPayable",
              0,
            ],
          },
        },

        orderSubtotalResolved: {
          $let: {
            vars: {
              itemsArray: {
                $cond: [
                  {
                    $isArray:
                      "$items",
                  },
                  "$items",
                  [],
                ],
              },
            },

            in: {
              $toDouble: {
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
                                input:
                                  "$$itemsArray",

                                as: "it",

                                in: {
                                  $multiply:
                                    [
                                      {
                                        $toDouble:
                                        {
                                          $cond:
                                            [
                                              {
                                                $gt:
                                                  [
                                                    {
                                                      $toDouble:
                                                      {
                                                        $ifNull:
                                                          [
                                                            "$$it.originalPrice",
                                                            0,
                                                          ],
                                                      },
                                                    },
                                                    0,
                                                  ],
                                              },

                                              "$$it.originalPrice",

                                              {
                                                $ifNull:
                                                  [
                                                    "$$it.finalPrice",
                                                    {
                                                      $ifNull:
                                                        [
                                                          "$$it.price",
                                                          {
                                                            $ifNull:
                                                              [
                                                                "$$it.sellingPrice",
                                                                {
                                                                  $ifNull:
                                                                    [
                                                                      "$$it.unitPrice",
                                                                      "$$it.mrp",
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

                                      {
                                        $max:
                                          [
                                            1,
                                            {
                                              $toDouble:
                                              {
                                                $ifNull:
                                                  [
                                                    "$$it.quantity",
                                                    1,
                                                  ],
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
    },

    /* =========================================================
       UNWIND PRODUCTS
    ========================================================= */

    {
      $unwind: {
        path: "$items",
        preserveNullAndEmptyArrays:
          false,
      },
    },

    /* =========================================================
       PRODUCT VALUES
    ========================================================= */

    {
      $addFields: {
        itemQty: {
          $max: [
            1,
            {
              $toDouble: {
                $ifNull: [
                  "$items.quantity",
                  1,
                ],
              },
            },
          ],
        },

        itemSize: {
          $ifNull: [
            "$items.selectedSize",
            {
              $ifNull: [
                "$items.size",
                "$items.variant.size",
              ],
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
                  $ifNull: [
                    "$items.taxInfo.hsnCode",
                    DEFAULT_HSN,
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
              $ifNull: [
                "$items.productModel",
                "Product",
              ],
            },
          ],
        },

        // Final discounted unit price
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
                        $ifNull: [
                          "$items.unitPrice",
                          "$items.mrp",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },

        // Original unit price before discount
        itemOriginalPriceIncl: {
          $cond: [
            {
              $gt: [
                {
                  $toDouble: {
                    $ifNull: [
                      "$items.originalPrice",
                      0,
                    ],
                  },
                },
                0,
              ],
            },

            {
              $toDouble:
                "$items.originalPrice",
            },

            {
              $toDouble: {
                $ifNull: [
                  "$items.finalPrice",
                  {
                    $ifNull: [
                      "$items.price",
                      0,
                    ],
                  },
                ],
              },
            },
          ],
        },

        itemStoredDiscount: {
          $toDouble: {
            $ifNull: [
              "$items.discountAmount",
              0,
            ],
          },
        },
      },
    },

    /* =========================================================
       LINE TOTALS
    ========================================================= */

    {
      $addFields: {
        itemGrossIncl: {
          $multiply: [
            "$itemPriceIncl",
            "$itemQty",
          ],
        },

        itemOriginalGrossIncl: {
          $multiply: [
            "$itemOriginalPriceIncl",
            "$itemQty",
          ],
        },
      },
    },

    /* =========================================================
       EMBEDDED DISCOUNT

       If item.price is already discounted:
       original gross - final gross gives actual discount.
    ========================================================= */

    {
      $addFields: {
        embeddedDiscount: {
          $max: [
            0,
            "$itemStoredDiscount",
            {
              $subtract: [
                "$itemOriginalGrossIncl",
                "$itemGrossIncl",
              ],
            },
          ],
        },
      },
    },

    /* =========================================================
       FINAL DISCOUNT

       New orders:
       Use embedded line discount.

       Legacy orders:
       Fall back to proportional order discount.
    ========================================================= */

    {
      $addFields: {
        allocatedDiscount: {
          $cond: [
            {
              $gt: [
                "$embeddedDiscount",
                0,
              ],
            },

            "$embeddedDiscount",

            {
              $cond: [
                {
                  $gt: [
                    "$orderSubtotalResolved",
                    0,
                  ],
                },

                {
                  $multiply: [
                    {
                      $divide: [
                        "$itemGrossIncl",
                        "$orderSubtotalResolved",
                      ],
                    },

                    "$orderDiscountResolved",
                  ],
                },

                0,
              ],
            },
          ],
        },
      },
    },

    /* =========================================================
       NET LINE

       Embedded discount means itemGrossIncl is already final.
       Legacy orders require allocated discount subtraction.
    ========================================================= */

    {
      $addFields: {
        netLine: {
          $cond: [
            {
              $gt: [
                "$embeddedDiscount",
                0,
              ],
            },

            "$itemGrossIncl",

            {
              $max: [
                0,
                {
                  $subtract: [
                    "$itemGrossIncl",
                    "$allocatedDiscount",
                  ],
                },
              ],
            },
          ],
        },
      },
    },

    /* =========================================================
       TAX
    ========================================================= */

    {
      $addFields: {
        taxableValue: {
          $divide: [
            "$netLine",
            1 + SALES_TAX_RATE,
          ],
        },

        taxAmount: {
          $subtract: [
            "$netLine",
            {
              $divide: [
                "$netLine",
                1 + SALES_TAX_RATE,
              ],
            },
          ],
        },

        deliveredMonth: {
          $dateToString: {
            format: "%Y-%m",
            date:
              "$deliveredAtResolved",
            timezone: IST,
          },
        },
      },
    }
  );

  /* =========================================================
     SEARCH
  ========================================================= */

  if (search) {
    const rx =
      escapeRegex(search);

    pipeline.push({
      $match: {
        $or: [
          {
            orderNumber: {
              $regex: rx,
              $options: "i",
            },
          },
          {
            customerNameResolved: {
              $regex: rx,
              $options: "i",
            },
          },
          {
            customerStateResolved: {
              $regex: rx,
              $options: "i",
            },
          },
          {
            couponCodeResolved: {
              $regex: rx,
              $options: "i",
            },
          },
          {
            itemHsn: {
              $regex: rx,
              $options: "i",
            },
          },
          {
            itemSize: {
              $regex: rx,
              $options: "i",
            },
          },
          {
            itemProductType: {
              $regex: rx,
              $options: "i",
            },
          },
          {
            paymentMethod: {
              $regex: rx,
              $options: "i",
            },
          },
          {
            courierNameResolved: {
              $regex: rx,
              $options: "i",
            },
          },
          {
            fulfillmentStatus: {
              $regex: rx,
              $options: "i",
            },
          },
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

const getCourierPartnerExpr = () => ({
  $switch: {
    branches: [
      {
        case: {
          $and: [
            {
              $ne: [
                { $ifNull: ["$shipment.provider", ""] },
                "",
              ],
            },
            {
              $ne: [
                "$shipment.provider",
                "unassigned",
              ],
            },
          ],
        },
        then: "$shipment.provider",
      },
      {
        case: {
          $ne: [
            {
              $ifNull: [
                "$shipment.delhivery.waybill",
                "",
              ],
            },
            "",
          ],
        },
        then: "delhivery",
      },
      {
        case: {
          $ne: [
            {
              $ifNull: [
                "$shipment.shiprocket.awb",
                "",
              ],
            },
            "",
          ],
        },
        then: "shiprocket",
      },
      {
        case: {
          $ne: [
            {
              $ifNull: [
                "$shipment.xpressbees.awb",
                "",
              ],
            },
            "",
          ],
        },
        then: "xpressbees",
      },
      {
        case: {
          $ne: [
            {
              $ifNull: [
                "$shipment.eshipz.awb",
                "",
              ],
            },
            "",
          ],
        },
        then: "eshipz",
      },
    ],
    default: "unassigned",
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
  const pipeline = buildSalesBasePipeline({
    month,
    search,
    startDate,
    endDate,
  });

  const [countAgg, rowsAgg, totalsAgg] = await Promise.all([
    Order.aggregate([...pipeline, { $count: "total" }]),

    Order.aggregate([
      ...pipeline,
      { $sort: { salesStatusDateResolved: -1, _id: -1 } },
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
          deliveredAt: "$salesStatusDateResolved",
          fulfillmentStatus: 1,
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
const buildSalesLedgerBasePipeline = ({
  month,
  search,
  startDate,
  endDate,
}) => {
  const fallback = (...values) =>
    values
      .slice(0, -1)
      .reduceRight(
        (result, value) => ({ $ifNull: [value, result] }),
        values.at(-1)
      );

  const num = (value, defaultValue = 0) => ({
    $toDouble: { $ifNull: [value, defaultValue] },
  });

  const pipeline = [
    {
      $addFields: {
        deliveredAtResolved: getDeliveredAtExpr(),
        salesStatusDateResolved: getSalesStatusDateExpr(),
        orderDateResolved: fallback(
          "$orderDate",
          "$createdAt",
          "$updatedAt"
        ),
      },
    },
    {
      $match: {
        isInfluencerOrder: { $ne: true },
        paymentMethod: { $ne: "exchange" },
        deliveredAtResolved: { $type: "date" },
        salesStatusDateResolved: { $type: "date" },
      },
    },
  ];

  // Filter using the same date displayed in Delivered Date
  if (month) {
    const range = getMonthRangeUTCFromISTMonth(month);

    if (range) {
      pipeline.push({
        $match: {
          salesStatusDateResolved: {
            $gte: range.startUTC,
            $lt: range.endUTC,
          },
        },
      });
    }
  }

  if (startDate || endDate) {
    const date = {};

    if (startDate) {
      date.$gte = new Date(`${startDate}T00:00:00.000Z`);
    }

    if (endDate) {
      date.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }

    pipeline.push({
      $match: { salesStatusDateResolved: date },
    });
  }

  pipeline.push(
    {
      $addFields: {
        customerNameResolved: getResolvedCustomerNameExpr(),
        customerStateResolved: getResolvedStateExpr(),
        courierNameResolved: getLedgerCourierExpr(),
        courierPartnerResolved: getCourierPartnerExpr(),

        orderDiscountResolved: num("$discount"),
        orderShippingResolved: num("$shippingFee"),

        orderSubtotalResolved: {
          $toDouble: {
            $ifNull: [
              "$subtotal",
              fallback(
                "$subTotal",
                "$cartTotal",
                {
                  $sum: {
                    $map: {
                      input: {
                        $cond: [{ $isArray: "$items" }, "$items", []],
                      },
                      as: "item",
                      in: {
                        $multiply: [
                          {
                            $toDouble: {
                              $cond: [
                                { $gt: [num("$$item.originalPrice"), 0] },
                                "$$item.originalPrice",
                                fallback(
                                  "$$item.finalPrice",
                                  "$$item.price",
                                  "$$item.sellingPrice",
                                  "$$item.unitPrice",
                                  "$$item.mrp"
                                ),
                              ],
                            },
                          },
                          { $max: [1, num("$$item.quantity", 1)] },
                        ],
                      },
                    },
                  },
                }
              ),
            ],
          },
        },
      },
    },

    { $unwind: "$items" },

    {
      $addFields: {
        itemQty: {
          $max: [1, num("$items.quantity", 1)],
        },

        itemSize: fallback(
          "$items.selectedSize",
          "$items.size",
          "$items.variant.size",
          ""
        ),

        itemHsn: fallback(
          "$items.productSnapshot.hsnCode",
          "$items.hsnCode",
          "$items.hsn",
          "$items.taxInfo.hsnCode",
          DEFAULT_HSN
        ),

        itemPriceIncl: num(
          fallback(
            "$items.finalPrice",
            "$items.price",
            "$items.sellingPrice",
            "$items.unitPrice",
            "$items.mrp",
            0
          )
        ),

        itemOriginalPriceIncl: {
          $cond: [
            { $gt: [num("$items.originalPrice"), 0] },
            num("$items.originalPrice"),
            num(fallback("$items.finalPrice", "$items.price", 0)),
          ],
        },

        itemStoredDiscount: num("$items.discountAmount"),
      },
    },

    {
      $addFields: {
        itemGrossIncl: {
          $multiply: ["$itemQty", "$itemPriceIncl"],
        },
        itemOriginalGrossIncl: {
          $multiply: ["$itemQty", "$itemOriginalPriceIncl"],
        },
      },
    },

    {
      $addFields: {
        embeddedDiscount: {
          $max: [
            0,
            "$itemStoredDiscount",
            {
              $subtract: [
                "$itemOriginalGrossIncl",
                "$itemGrossIncl",
              ],
            },
          ],
        },

        shippingCharges: {
          $cond: [
            { $gt: ["$orderSubtotalResolved", 0] },
            {
              $multiply: [
                {
                  $divide: [
                    "$itemOriginalGrossIncl",
                    "$orderSubtotalResolved",
                  ],
                },
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
        totalDiscount: {
          $cond: [
            { $gt: ["$embeddedDiscount", 0] },
            "$embeddedDiscount",
            {
              $cond: [
                { $gt: ["$orderSubtotalResolved", 0] },
                {
                  $multiply: [
                    {
                      $divide: [
                        "$itemGrossIncl",
                        "$orderSubtotalResolved",
                      ],
                    },
                    "$orderDiscountResolved",
                  ],
                },
                0,
              ],
            },
          ],
        },
      },
    },

    {
      $addFields: {
        netInclusive: {
          $cond: [
            { $gt: ["$embeddedDiscount", 0] },
            {
              $add: [
                "$itemGrossIncl",
                "$shippingCharges",
              ],
            },
            {
              $max: [
                0,
                {
                  $subtract: [
                    {
                      $add: [
                        "$itemGrossIncl",
                        "$shippingCharges",
                      ],
                    },
                    "$totalDiscount",
                  ],
                },
              ],
            },
          ],
        },

        taxRate: { $literal: "5%" },

        paymentType: {
          $cond: [
            { $eq: ["$paymentMethod", "cod"] },
            "COD",
            "Prepaid",
          ],
        },
      },
    },

    {
      $addFields: {
        orderInclusive: {
          $max: [
            0,
            {
              $subtract: [
                "$netInclusive",
                "$shippingCharges",
              ],
            },
          ],
        },
        shippingTaxable: {
          $divide: ["$shippingCharges", 1.05],
        },
      },
    },

    {
      $addFields: {
        orderTaxable: {
          $divide: ["$orderInclusive", 1.05],
        },
        shippingTaxAmount: {
          $subtract: [
            "$shippingCharges",
            "$shippingTaxable",
          ],
        },
      },
    },

    {
      $addFields: {
        orderTaxAmount: {
          $subtract: [
            "$orderInclusive",
            "$orderTaxable",
          ],
        },
        taxable: {
          $add: [
            "$orderTaxable",
            "$shippingTaxable",
          ],
        },
      },
    },

    {
      $addFields: {
        totalTaxAmount: {
          $add: [
            "$orderTaxAmount",
            "$shippingTaxAmount",
          ],
        },
        taxAmount: {
          $add: [
            "$orderTaxAmount",
            "$shippingTaxAmount",
          ],
        },
      },
    }
  );

  if (search) {
    const match = {
      $regex: escapeRegex(search),
      $options: "i",
    };

    pipeline.push({
      $match: {
        $or: [
          { orderNumber: match },
          { customerNameResolved: match },
          { customerStateResolved: match },
          { courierNameResolved: match },
          { courierPartnerResolved: match },
          { itemHsn: match },
          { itemSize: match },
          { paymentMethod: match },
          { fulfillmentStatus: match },
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

  const pipeline =
    buildSalesLedgerBasePipeline({
      month,
      search,
      startDate,
      endDate,
    });

  const [countAgg, rowsAgg, totalsAgg] =
    await Promise.all([
      Order.aggregate([
        ...pipeline,
        { $count: "total" },
      ]),

      Order.aggregate([
        ...pipeline,

        {
          $sort: {
            salesStatusDateResolved: -1,
            orderDateResolved: -1,
            _id: -1,
          },
        },

        { $skip: skip },
        { $limit: limit },

        {
          $project: {
            _id: 0,

            orderId: "$orderNumber",
            orderDate: "$orderDateResolved",
            deliveredDate:
              "$salesStatusDateResolved",

            fulfillmentStatus: 1,

            customerName: {
              $ifNull: [
                "$customerNameResolved",
                "",
              ],
            },

            state: {
              $ifNull: [
                "$customerStateResolved",
                "",
              ],
            },

            paymentType: {
              $ifNull: [
                "$paymentType",
                "",
              ],
            },

            courierPartner: {
              $ifNull: [
                "$courierPartnerResolved",
                "",
              ],
            },

            hsnCode: {
              $ifNull: [
                "$itemHsn",
                DEFAULT_HSN,
              ],
            },

            size: {
              $ifNull: [
                "$itemSize",
                "",
              ],
            },

            qty: {
              $ifNull: [
                "$itemQty",
                1,
              ],
            },

            unitInclusiveTax: {
              $ifNull: [
                "$itemPriceIncl",
                0,
              ],
            },

            totalDiscount: {
              $ifNull: [
                "$totalDiscount",
                0,
              ],
            },

            netInclusive: {
              $ifNull: [
                "$netInclusive",
                0,
              ],
            },

            orderTaxable: {
              $ifNull: [
                "$orderTaxable",
                0,
              ],
            },

            shippingCharges: {
              $ifNull: [
                "$shippingCharges",
                0,
              ],
            },

            shippingTaxable: {
              $ifNull: [
                "$shippingTaxable",
                0,
              ],
            },

            taxable: {
              $ifNull: [
                "$taxable",
                0,
              ],
            },

            orderTaxAmount: {
              $ifNull: [
                "$orderTaxAmount",
                0,
              ],
            },

            shippingTaxAmount: {
              $ifNull: [
                "$shippingTaxAmount",
                0,
              ],
            },

            totalTaxAmount: {
              $ifNull: [
                "$totalTaxAmount",
                0,
              ],
            },

            taxRate: {
              $ifNull: [
                "$taxRate",
                "5%",
              ],
            },
          },
        },
      ]),

      Order.aggregate([
        ...pipeline,

        {
          $group: {
            _id: null,

            rows: { $sum: 1 },

            ordersSet: {
              $addToSet: "$_id",
            },

            totalDiscount: {
              $sum: "$totalDiscount",
            },

            netInclusive: {
              $sum: "$netInclusive",
            },

            orderTaxable: {
              $sum: "$orderTaxable",
            },

            shippingCharges: {
              $sum: "$shippingCharges",
            },

            shippingTaxable: {
              $sum: "$shippingTaxable",
            },

            taxable: {
              $sum: "$taxable",
            },

            orderTaxAmount: {
              $sum: "$orderTaxAmount",
            },

            shippingTaxAmount: {
              $sum: "$shippingTaxAmount",
            },

            totalTaxAmount: {
              $sum: "$totalTaxAmount",
            },
          },
        },

        {
          $project: {
            _id: 0,
            rows: 1,

            orders: {
              $size: {
                $ifNull: [
                  "$ordersSet",
                  [],
                ],
              },
            },

            totalDiscount: 1,
            netInclusive: 1,
            orderTaxable: 1,
            shippingCharges: 1,
            shippingTaxable: 1,
            taxable: 1,
            orderTaxAmount: 1,
            shippingTaxAmount: 1,
            totalTaxAmount: 1,
          },
        },
      ]),
    ]);

  const totalRows = toNum(
    countAgg?.[0]?.total,
    0
  );

  const totalPages = Math.max(
    1,
    Math.ceil(totalRows / limit)
  );

  const totalsDoc =
    totalsAgg?.[0] || {};

  const rows = Array.isArray(rowsAgg)
    ? rowsAgg.map((row) => ({
      ...row,

      qty: toNum(row.qty),

      unitInclusiveTax: money(
        row.unitInclusiveTax
      ),

      totalDiscount: money(
        row.totalDiscount
      ),

      netInclusive: money(
        row.netInclusive
      ),

      orderTaxable: money(
        row.orderTaxable
      ),

      shippingCharges: money(
        row.shippingCharges
      ),

      shippingTaxable: money(
        row.shippingTaxable
      ),

      taxable: money(
        row.taxable
      ),

      orderTaxAmount: money(
        row.orderTaxAmount
      ),

      shippingTaxAmount: money(
        row.shippingTaxAmount
      ),

      totalTaxAmount: money(
        row.totalTaxAmount
      ),
    }))
    : [];

  return {
    success: true,
    rows,

    totals: {
      rows: toNum(totalsDoc.rows),
      orders: toNum(totalsDoc.orders),

      totalDiscount: money(
        totalsDoc.totalDiscount
      ),

      netInclusive: money(
        totalsDoc.netInclusive
      ),

      orderTaxable: money(
        totalsDoc.orderTaxable
      ),

      shippingCharges: money(
        totalsDoc.shippingCharges
      ),

      shippingTaxable: money(
        totalsDoc.shippingTaxable
      ),

      taxable: money(
        totalsDoc.taxable
      ),

      orderTaxAmount: money(
        totalsDoc.orderTaxAmount
      ),

      shippingTaxAmount: money(
        totalsDoc.shippingTaxAmount
      ),

      totalTaxAmount: money(
        totalsDoc.totalTaxAmount
      ),
    },

    meta: {
      page,
      limit,
      totalRows,
      totalPages,
      hasNextPage:
        page < totalPages,
      hasPrevPage:
        page > 1,
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
      Math.max(1, parseInt(String(req.query.limit || "100"), 10) || 100),
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

export const downloadSalesLedgerCsv = async (
  req,
  res
) => {
  try {
    const month = String(
      req.query.month || ""
    ).trim();

    const search = String(
      req.query.search || ""
    ).trim();

    const startDate = String(
      req.query.startDate || ""
    ).trim();

    const endDate = String(
      req.query.endDate || ""
    ).trim();

    const filters = {
      month,
      search,
      startDate,
      endDate,
      limit: MAX_LIMIT,
    };

    const first =
      await buildSalesLedgerResponse({
        ...filters,
        page: 1,
      });

    let rows = Array.isArray(
      first?.rows
    )
      ? [...first.rows]
      : [];

    const totalPages = Math.max(
      1,
      Number(
        first?.meta?.totalPages || 1
      )
    );

    if (totalPages > 1) {
      const pages =
        await Promise.all(
          Array.from(
            {
              length:
                totalPages - 1,
            },
            (_, index) =>
              buildSalesLedgerResponse({
                ...filters,
                page: index + 2,
              })
          )
        );

      pages.forEach((pageData) => {
        if (
          Array.isArray(
            pageData?.rows
          )
        ) {
          rows.push(
            ...pageData.rows
          );
        }
      });
    }

    const header = [
      "Order ID",
      "Order Date",
      "Delivered Date",
      "Customer Name",
      "State",
      "Payment Type",
      "Courier Partner",
      "HSN Code",
      "Size",
      "Qty",
      "Unit (Inclusive Tax)",
      "Unit (Tax Exclusive)",
      "Shipping Taxable",
      "Total Tax",
      "Tax Rate",
    ];

    const escapeCsv = (value) =>
      `"${String(
        value ?? ""
      ).replace(/"/g, '""')}"`;

    const csv = [
      header.join(","),

      ...rows.map((row) => {
        const quantity = Math.max(
          1,
          Number(row?.qty || 1)
        );

        const unitTaxExclusive =
          Number(
            row?.orderTaxable || 0
          ) / quantity;

        return [
          row?.orderId,
          row?.orderDate,
          row?.deliveredDate,
          row?.customerName,
          row?.state,
          row?.paymentType,
          row?.courierPartner,

          // Enforced common HSN
          DEFAULT_HSN,

          row?.size,
          quantity,
          row?.unitInclusiveTax,

          Number(
            unitTaxExclusive.toFixed(2)
          ),

          row?.shippingTaxable,
          row?.totalTaxAmount,
          row?.taxRate,
        ]
          .map(escapeCsv)
          .join(",");
      }),
    ].join("\n");

    res.setHeader(
      "Content-Type",
      "text/csv; charset=utf-8"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=sales-ledger-${month || "all"}.csv`
    );

    return res
      .status(200)
      .send(`\uFEFF${csv}`);
  } catch (error) {
    console.error(
      "downloadSalesLedgerCsv error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to download sales ledger csv",
      error:
        error?.message ||
        "Server error",
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
      Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50),
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
      Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50),
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
      },
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
