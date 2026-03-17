// Orders/orderReportsController.js

import Order from "./Orders.js"; // ✅ path adjust if needed

const toInt = (v, d = 0) => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildMonthRange = (month) => {
  const raw = String(month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return null;

  const [y, m] = raw.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;

  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));

  return { start, end };
};

export const getProductSalesReport = async (req, res) => {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
    const skip = (page - 1) * limit;

    const month = String(req.query.month || "").trim();
    const search = String(req.query.search || "").trim();
    const sort = String(req.query.sort || "qty_desc").trim();

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

      // ✅ total orders considered
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

export default {
  getProductSalesReport,
};