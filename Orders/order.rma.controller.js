import mongoose from "mongoose";
import Order from "./Orders.js";
import Product from "../Products/Products.js";

/* =========================================================
   HELPERS
========================================================= */
const toObjectId = (value) => {
  try {
    return new mongoose.Types.ObjectId(value);
  } catch {
    return null;
  }
};

const parsePositiveInt = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
};

const buildDateRange = (startDate, endDate) => {
  const range = {};

  if (startDate) {
    const start = new Date(startDate);
    if (!Number.isNaN(start.getTime())) {
      start.setHours(0, 0, 0, 0);
      range.$gte = start;
    }
  }

  if (endDate) {
    const end = new Date(endDate);
    if (!Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      range.$lte = end;
    }
  }

  return Object.keys(range).length ? range : null;
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* =========================================================
   GET RMA REASONS GROUPED BY PRODUCT CODE
   Purpose:
   - group all return/exchange reasons by productCode
   - include product details for design/production team
   - include productCode, price, image, description
========================================================= */
export const getRmaReasonsGroupedByProductCode = async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 25), 200);
    const skip = (page - 1) * limit;

    const {
      startDate,
      endDate,
      type,
      status,
      reason,
      search = "",
      sortBy = "totalRmaQty",
      sortOrder = "desc",
    } = req.query;

    const orderMatch = {};
    const rmaMatch = {};
    const dateRange = buildDateRange(startDate, endDate);

    if (dateRange) {
      orderMatch.orderDate = dateRange;
    }

    if (type) {
      rmaMatch["rmas.type"] = String(type).trim().toLowerCase();
    }

    if (status) {
      rmaMatch["rmas.status"] = String(status).trim().toLowerCase();
    }

    if (reason) {
      rmaMatch["rmas.reason"] = String(reason).trim().toLowerCase();
    }

    const searchRegex = search.trim()
      ? new RegExp(escapeRegex(search.trim()), "i")
      : null;

    const pipeline = [
      { $match: orderMatch },

      { $unwind: "$rmas" },

      ...(Object.keys(rmaMatch).length ? [{ $match: rmaMatch }] : []),

      { $unwind: "$rmas.items" },

      {
        $addFields: {
          matchedOrderItem: {
            $first: {
              $filter: {
                input: "$items",
                as: "orderItem",
                cond: {
                  $eq: ["$$orderItem.lineId", "$rmas.items.orderLineId"],
                },
              },
            },
          },
        },
      },

      {
        $addFields: {
          effectiveProductCode: {
            $ifNull: [
              "$rmas.items.productCode",
              "$matchedOrderItem.productSnapshot.productCode",
            ],
          },
          effectiveTitle: {
            $ifNull: [
              "$rmas.items.title",
              "$matchedOrderItem.productSnapshot.title",
            ],
          },
          effectiveProductId: {
            $ifNull: ["$rmas.items.productId", "$matchedOrderItem.productId"],
          },
          effectiveImage: {
            $ifNull: [
              "$matchedOrderItem.productSnapshot.thumbnail",
              {
                $arrayElemAt: ["$matchedOrderItem.productSnapshot.images", 0],
              },
            ],
          },
          effectivePrice: "$matchedOrderItem.price",
          effectiveQty: "$rmas.items.quantity",
        },
      },

      {
        $match: {
          effectiveProductCode: { $exists: true, $ne: "" },
          ...(searchRegex
            ? {
                $or: [
                  { effectiveProductCode: { $regex: searchRegex } },
                  { effectiveTitle: { $regex: searchRegex } },
                  { "rmas.reason": { $regex: searchRegex } },
                  { orderNumber: { $regex: searchRegex } },
                ],
              }
            : {}),
        },
      },

      {
        $group: {
          _id: "$effectiveProductCode",

          productCode: { $first: "$effectiveProductCode" },
          title: { $first: "$effectiveTitle" },
          image: { $first: "$effectiveImage" },

          fallbackProductId: { $first: "$effectiveProductId" },
          lastOrderedPrice: { $first: "$effectivePrice" },

          totalRmaCases: { $sum: 1 },
          totalRmaQty: { $sum: { $ifNull: ["$effectiveQty", 0] } },

          returnCases: {
            $sum: {
              $cond: [{ $eq: ["$rmas.type", "return"] }, 1, 0],
            },
          },
          exchangeCases: {
            $sum: {
              $cond: [{ $eq: ["$rmas.type", "exchange"] }, 1, 0],
            },
          },

          deliveredOrdersAffected: { $addToSet: "$orderNumber" },
          customersAffected: { $addToSet: "$customerId" },

          reasonsRaw: {
            $push: {
              reason: "$rmas.reason",
              qty: { $ifNull: ["$effectiveQty", 0] },
              type: "$rmas.type",
              status: "$rmas.status",
              rmaNumber: "$rmas.rmaNumber",
              orderNumber: "$orderNumber",
              customerNote: "$rmas.customerNote",
              adminNote: "$rmas.adminNote",
              createdAt: "$rmas.createdAt",
            },
          },

          recentRmas: {
            $push: {
              rmaNumber: "$rmas.rmaNumber",
              orderNumber: "$orderNumber",
              reason: "$rmas.reason",
              type: "$rmas.type",
              status: "$rmas.status",
              quantity: "$effectiveQty",
              customerNote: "$rmas.customerNote",
              adminNote: "$rmas.adminNote",
              createdAt: "$rmas.createdAt",
            },
          },
        },
      },

      {
        $lookup: {
          from: Product.collection.name,
          localField: "productCode",
          foreignField: "productCode",
          as: "productDoc",
        },
      },

      {
        $addFields: {
          productDoc: { $first: "$productDoc" },
        },
      },

      {
        $addFields: {
          productId: {
            $ifNull: ["$productDoc._id", "$fallbackProductId"],
          },
          title: {
            $ifNull: ["$productDoc.title", "$title"],
          },
          image: {
            $ifNull: [
              "$productDoc.thumbnail",
              { $arrayElemAt: ["$productDoc.images", 0] },
              "$image",
            ],
          },
          price: {
            $ifNull: ["$productDoc.price", "$lastOrderedPrice", 0],
          },
          description: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ["$productDoc.shortDescription", ""] },
                  {
                    $cond: [
                      {
                        $and: [
                          { $ne: [{ $ifNull: ["$productDoc.shortDescription", ""] }, ""] },
                          { $ne: [{ $ifNull: ["$productDoc.howToStyle", ""] }, ""] },
                        ],
                      },
                      " ",
                      "",
                    ],
                  },
                  { $ifNull: ["$productDoc.howToStyle", ""] },
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $ne: [
                              {
                                $concat: [
                                  { $ifNull: ["$productDoc.shortDescription", ""] },
                                  { $ifNull: ["$productDoc.howToStyle", ""] },
                                ],
                              },
                              "",
                            ],
                          },
                          { $ne: [{ $ifNull: ["$productDoc.fabricDetails", ""] }, ""] },
                        ],
                      },
                      " ",
                      "",
                    ],
                  },
                  { $ifNull: ["$productDoc.fabricDetails", ""] },
                ],
              },
            },
          },
        },
      },

      {
        $addFields: {
          affectedOrdersCount: { $size: "$deliveredOrdersAffected" },
          affectedCustomersCount: { $size: "$customersAffected" },

          reasonSummary: {
            wrong_size: {
              count: {
                $size: {
                  $filter: {
                    input: "$reasonsRaw",
                    as: "r",
                    cond: { $eq: ["$$r.reason", "wrong_size"] },
                  },
                },
              },
              qty: {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: "$reasonsRaw",
                        as: "r",
                        cond: { $eq: ["$$r.reason", "wrong_size"] },
                      },
                    },
                    as: "x",
                    in: { $ifNull: ["$$x.qty", 0] },
                  },
                },
              },
            },
            wrong_item: {
              count: {
                $size: {
                  $filter: {
                    input: "$reasonsRaw",
                    as: "r",
                    cond: { $eq: ["$$r.reason", "wrong_item"] },
                  },
                },
              },
              qty: {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: "$reasonsRaw",
                        as: "r",
                        cond: { $eq: ["$$r.reason", "wrong_item"] },
                      },
                    },
                    as: "x",
                    in: { $ifNull: ["$$x.qty", 0] },
                  },
                },
              },
            },
            damaged: {
              count: {
                $size: {
                  $filter: {
                    input: "$reasonsRaw",
                    as: "r",
                    cond: { $eq: ["$$r.reason", "damaged"] },
                  },
                },
              },
              qty: {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: "$reasonsRaw",
                        as: "r",
                        cond: { $eq: ["$$r.reason", "damaged"] },
                      },
                    },
                    as: "x",
                    in: { $ifNull: ["$$x.qty", 0] },
                  },
                },
              },
            },
            defective: {
              count: {
                $size: {
                  $filter: {
                    input: "$reasonsRaw",
                    as: "r",
                    cond: { $eq: ["$$r.reason", "defective"] },
                  },
                },
              },
              qty: {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: "$reasonsRaw",
                        as: "r",
                        cond: { $eq: ["$$r.reason", "defective"] },
                      },
                    },
                    as: "x",
                    in: { $ifNull: ["$$x.qty", 0] },
                  },
                },
              },
            },
            quality_issue: {
              count: {
                $size: {
                  $filter: {
                    input: "$reasonsRaw",
                    as: "r",
                    cond: { $eq: ["$$r.reason", "quality_issue"] },
                  },
                },
              },
              qty: {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: "$reasonsRaw",
                        as: "r",
                        cond: { $eq: ["$$r.reason", "quality_issue"] },
                      },
                    },
                    as: "x",
                    in: { $ifNull: ["$$x.qty", 0] },
                  },
                },
              },
            },
            changed_mind: {
              count: {
                $size: {
                  $filter: {
                    input: "$reasonsRaw",
                    as: "r",
                    cond: { $eq: ["$$r.reason", "changed_mind"] },
                  },
                },
              },
              qty: {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: "$reasonsRaw",
                        as: "r",
                        cond: { $eq: ["$$r.reason", "changed_mind"] },
                      },
                    },
                    as: "x",
                    in: { $ifNull: ["$$x.qty", 0] },
                  },
                },
              },
            },
            other: {
              count: {
                $size: {
                  $filter: {
                    input: "$reasonsRaw",
                    as: "r",
                    cond: { $eq: ["$$r.reason", "other"] },
                  },
                },
              },
              qty: {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: "$reasonsRaw",
                        as: "r",
                        cond: { $eq: ["$$r.reason", "other"] },
                      },
                    },
                    as: "x",
                    in: { $ifNull: ["$$x.qty", 0] },
                  },
                },
              },
            },
          },

          recentRmas: {
            $slice: [
              {
                $sortArray: {
                  input: "$recentRmas",
                  sortBy: { createdAt: -1 },
                },
              },
              10,
            ],
          },
        },
      },

      {
        $project: {
          _id: 0,
          productId: 1,
          productCode: 1,
          title: 1,
          image: 1,
          price: 1,
          description: 1,

          totalRmaCases: 1,
          totalRmaQty: 1,
          returnCases: 1,
          exchangeCases: 1,
          affectedOrdersCount: 1,
          affectedCustomersCount: 1,

          reasonSummary: 1,
          recentRmas: 1,
        },
      },

      {
        $sort: {
          [sortBy]: sortOrder === "asc" ? 1 : -1,
          productCode: 1,
        },
      },

      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          meta: [{ $count: "total" }],
        },
      },
    ];

    const [result] = await Order.aggregate(pipeline);

    const rows = result?.data || [];
    const total = result?.meta?.[0]?.total || 0;

    return res.status(200).json({
      success: true,
      message: "RMA reasons grouped by product code fetched successfully",
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
        type: type || null,
        status: status || null,
        reason: reason || null,
        search: search || "",
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasNextPage: skip + rows.length < total,
        hasPrevPage: page > 1,
      },
      data: rows,
    });
  } catch (error) {
    console.error("getRmaReasonsGroupedByProductCode error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch RMA reasons grouped by product code",
      error: error.message,
    });
  }
};