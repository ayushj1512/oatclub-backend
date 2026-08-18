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

      ...(Object.keys(rmaMatch).length
        ? [{ $match: rmaMatch }]
        : []),

      { $unwind: "$rmas.items" },

      /* =====================================================
         MATCH RMA ITEM WITH ORIGINAL ORDER ITEM
      ===================================================== */
      {
        $addFields: {
          matchedOrderItem: {
            $first: {
              $filter: {
                input: "$items",
                as: "orderItem",
                cond: {
                  $eq: [
                    "$$orderItem.lineId",
                    "$rmas.items.orderLineId",
                  ],
                },
              },
            },
          },
        },
      },

      /* =====================================================
         NORMALIZED PRODUCT + VARIANT DETAILS
      ===================================================== */
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
            $ifNull: [
              "$rmas.items.productId",
              "$matchedOrderItem.productId",
            ],
          },

          effectiveImage: {
            $ifNull: [
              "$matchedOrderItem.productSnapshot.thumbnail",
              {
                $arrayElemAt: [
                  "$matchedOrderItem.productSnapshot.images",
                  0,
                ],
              },
            ],
          },

          effectivePrice: {
            $ifNull: ["$matchedOrderItem.price", 0],
          },

          effectiveQty: {
            $ifNull: ["$rmas.items.quantity", 0],
          },

          effectiveSize: {
            $ifNull: [
              "$matchedOrderItem.selectedSize",
              "",
            ],
          },

          effectiveColor: {
            $ifNull: [
              "$matchedOrderItem.selectedColor",
              "",
            ],
          },

          effectiveVariantSku: {
            $ifNull: [
              "$rmas.items.variantSku",
              "$matchedOrderItem.variant.sku",
              "",
            ],
          },

          effectiveLineId: {
            $ifNull: [
              "$rmas.items.orderLineId",
              "$matchedOrderItem.lineId",
              "",
            ],
          },

          effectiveSubtotal: {
            $ifNull: [
              "$matchedOrderItem.subtotal",
              0,
            ],
          },

          effectiveDiscountAmount: {
            $ifNull: [
              "$matchedOrderItem.discountAmount",
              0,
            ],
          },

          effectiveTaxAmount: {
            $ifNull: [
              "$matchedOrderItem.taxAmount",
              0,
            ],
          },
        },
      },

      /* =====================================================
         SEARCH
      ===================================================== */
      {
        $match: {
          effectiveProductCode: {
            $exists: true,
            $ne: "",
          },

          ...(searchRegex
            ? {
              $or: [
                {
                  effectiveProductCode: {
                    $regex: searchRegex,
                  },
                },
                {
                  effectiveTitle: {
                    $regex: searchRegex,
                  },
                },
                {
                  effectiveVariantSku: {
                    $regex: searchRegex,
                  },
                },
                {
                  effectiveSize: {
                    $regex: searchRegex,
                  },
                },
                {
                  "rmas.reason": {
                    $regex: searchRegex,
                  },
                },
                {
                  "rmas.rmaNumber": {
                    $regex: searchRegex,
                  },
                },
                {
                  orderNumber: {
                    $regex: searchRegex,
                  },
                },
                {
                  "shippingAddressSnapshot.fullName": {
                    $regex: searchRegex,
                  },
                },
                {
                  "shippingAddressSnapshot.phone": {
                    $regex: searchRegex,
                  },
                },
                {
                  "shippingAddressSnapshot.email": {
                    $regex: searchRegex,
                  },
                },
              ],
            }
            : {}),
        },
      },

      /* =====================================================
         GROUP PRODUCT-WISE
      ===================================================== */
      {
        $group: {
          _id: "$effectiveProductCode",

          productCode: {
            $first: "$effectiveProductCode",
          },

          title: {
            $first: "$effectiveTitle",
          },

          image: {
            $first: "$effectiveImage",
          },

          fallbackProductId: {
            $first: "$effectiveProductId",
          },

          lastOrderedPrice: {
            $first: "$effectivePrice",
          },

          totalRmaCases: {
            $sum: 1,
          },

          totalRmaQty: {
            $sum: "$effectiveQty",
          },

          returnCases: {
            $sum: {
              $cond: [
                { $eq: ["$rmas.type", "return"] },
                1,
                0,
              ],
            },
          },

          exchangeCases: {
            $sum: {
              $cond: [
                { $eq: ["$rmas.type", "exchange"] },
                1,
                0,
              ],
            },
          },

          deliveredOrdersAffected: {
            $addToSet: "$orderNumber",
          },

          customersAffected: {
            $addToSet: "$customerId",
          },

          /* =================================================
             REASON SUMMARY
          ================================================= */
          reasonsRaw: {
            $push: {
              reason: "$rmas.reason",
              qty: "$effectiveQty",
            },
          },

          /* =================================================
             FULL RMA DETAILS FOR EXPAND + CSV
          ================================================= */
          recentRmas: {
            $push: {
              /* ---------- ORDER ---------- */
              orderId: "$_id",
              orderNumber: "$orderNumber",
              orderDate: "$orderDate",
              orderCreatedAt: "$createdAt",

              orderType: "$orderType",
              source: "$source",

              paymentMethod: "$paymentMethod",
              paymentStatus: "$paymentStatus",
              fulfillmentStatus: "$fulfillmentStatus",

              orderFinalPayable: "$finalPayable",
              orderSubtotal: "$subtotal",
              orderDiscount: "$discount",
              orderShippingFee: "$shippingFee",
              orderTax: "$tax",

              /* ---------- CUSTOMER ---------- */
              customerId: "$customerId",

              customerName: {
                $ifNull: [
                  "$shippingAddressSnapshot.fullName",
                  "$billingAddressSnapshot.fullName",
                  "",
                ],
              },

              customerPhone: {
                $ifNull: [
                  "$shippingAddressSnapshot.phone",
                  "$billingAddressSnapshot.phone",
                  "",
                ],
              },

              customerEmail: {
                $ifNull: [
                  "$shippingAddressSnapshot.email",
                  "$billingAddressSnapshot.email",
                  "",
                ],
              },

              customerCity: {
                $ifNull: [
                  "$shippingAddressSnapshot.city",
                  "",
                ],
              },

              customerState: {
                $ifNull: [
                  "$shippingAddressSnapshot.state",
                  "",
                ],
              },

              customerPincode: {
                $ifNull: [
                  "$shippingAddressSnapshot.pincode",
                  "",
                ],
              },

              /* ---------- PRODUCT ---------- */
              productId: "$effectiveProductId",
              productCode: "$effectiveProductCode",
              productName: "$effectiveTitle",

              productSize: "$effectiveSize",
              productColor: "$effectiveColor",
              variantSku: "$effectiveVariantSku",
              orderLineId: "$effectiveLineId",

              productPrice: "$effectivePrice",
              productSubtotal: "$effectiveSubtotal",
              productDiscount: "$effectiveDiscountAmount",
              productTax: "$effectiveTaxAmount",

              /* ---------- RMA ---------- */
              rmaNumber: "$rmas.rmaNumber",
              type: "$rmas.type",
              reason: "$rmas.reason",
              status: "$rmas.status",
              resolution: "$rmas.resolution",
              isFulfilled: "$rmas.isFulfilled",

              quantity: "$effectiveQty",

              customerNote: "$rmas.customerNote",
              adminNote: "$rmas.adminNote",

              rmaCreatedAt: "$rmas.createdAt",
              rmaUpdatedAt: "$rmas.updatedAt",

              /* ---------- EXCHANGE ---------- */
              exchangeProductId:
                "$rmas.exchangeRequest.productId",

              exchangeVariantId:
                "$rmas.exchangeRequest.variantId",

              exchangeVariantSku:
                "$rmas.exchangeRequest.variantSku",

              exchangeAttributes:
                "$rmas.exchangeRequest.attributes",

              exchangeNote:
                "$rmas.exchangeRequest.note",

              /* ---------- EXCHANGE FEE ---------- */
              exchangeFeeAmount:
                "$rmas.fee.amount",

              exchangeFeeCurrency:
                "$rmas.fee.currency",

              exchangeFeeStatus:
                "$rmas.fee.status",

              /* ---------- REFUND ---------- */
              refundAmount:
                "$rmas.refund.amount",

              refundMode:
                "$rmas.refund.mode",

              refundStatus:
                "$rmas.refund.status",

              refundReferenceId:
                "$rmas.refund.referenceId",

              /* ---------- FORWARD DELIVERY DATES ---------- */
              deliveredAt: {
                $ifNull: [
                  "$fulfillmentDates.deliveredAt",
                  "$shipment.deliveredAt",
                  "$trackingDetails.deliveredAt",
                ],
              },

              shippedAt: {
                $ifNull: [
                  "$fulfillmentDates.shippedAt",
                  "$shipment.shippedAt",
                  "$trackingDetails.shippedAt",
                ],
              },

              packedAt:
                "$fulfillmentDates.packedAt",

              /* ---------- REVERSE SHIPMENT ---------- */
              reverseProvider:
                "$rmas.reverseShipment.provider",

              reverseOrderId:
                "$rmas.reverseShipment.orderId",

              reverseShipmentId:
                "$rmas.reverseShipment.shipmentId",

              reverseStatus:
                "$rmas.reverseShipment.status",

              reverseRawStatus:
                "$rmas.reverseShipment.rawStatus",

              reverseCourierId:
                "$rmas.reverseShipment.courierId",

              reverseCourierName:
                "$rmas.reverseShipment.courierName",

              reverseAwb:
                "$rmas.reverseShipment.awb",

              reverseTrackingUrl:
                "$rmas.reverseShipment.trackingUrl",

              reverseFreightCharge:
                "$rmas.reverseShipment.freightCharge",

              reversePickupScheduledAt:
                "$rmas.reverseShipment.pickupScheduledAt",

              reverseExpectedPickupAt:
                "$rmas.reverseShipment.expectedPickupAt",

              reversePickedAt:
                "$rmas.reverseShipment.pickedAt",

              reverseInTransitAt:
                "$rmas.reverseShipment.inTransitAt",

              reverseReceivedAt:
                "$rmas.reverseShipment.receivedAt",

              reverseAwbAssignedAt:
                "$rmas.reverseShipment.awbAssignedAt",
            },
          },
        },
      },

      /* =====================================================
         PRODUCT MASTER DATA
      ===================================================== */
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
          productDoc: {
            $first: "$productDoc",
          },
        },
      },

      {
        $addFields: {
          productId: {
            $ifNull: [
              "$productDoc._id",
              "$fallbackProductId",
            ],
          },

          title: {
            $ifNull: [
              "$productDoc.title",
              "$title",
            ],
          },

          image: {
            $ifNull: [
              "$productDoc.thumbnail",
              {
                $arrayElemAt: [
                  "$productDoc.images",
                  0,
                ],
              },
              "$image",
            ],
          },

          price: {
            $ifNull: [
              "$productDoc.price",
              "$lastOrderedPrice",
              0,
            ],
          },
        },
      },

      /* =====================================================
         TOTALS + REASON SUMMARY
      ===================================================== */
      {
        $addFields: {
          affectedOrdersCount: {
            $size: "$deliveredOrdersAffected",
          },

          affectedCustomersCount: {
            $size: "$customersAffected",
          },

          reasonSummary: {
            wrong_size: {
              count: {
                $size: {
                  $filter: {
                    input: "$reasonsRaw",
                    as: "r",
                    cond: {
                      $eq: [
                        "$$r.reason",
                        "wrong_size",
                      ],
                    },
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
                        cond: {
                          $eq: [
                            "$$r.reason",
                            "wrong_size",
                          ],
                        },
                      },
                    },
                    as: "r",
                    in: {
                      $ifNull: ["$$r.qty", 0],
                    },
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
                    cond: {
                      $eq: [
                        "$$r.reason",
                        "wrong_item",
                      ],
                    },
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
                        cond: {
                          $eq: [
                            "$$r.reason",
                            "wrong_item",
                          ],
                        },
                      },
                    },
                    as: "r",
                    in: {
                      $ifNull: ["$$r.qty", 0],
                    },
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
                    cond: {
                      $eq: [
                        "$$r.reason",
                        "damaged",
                      ],
                    },
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
                        cond: {
                          $eq: [
                            "$$r.reason",
                            "damaged",
                          ],
                        },
                      },
                    },
                    as: "r",
                    in: {
                      $ifNull: ["$$r.qty", 0],
                    },
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
                    cond: {
                      $eq: [
                        "$$r.reason",
                        "defective",
                      ],
                    },
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
                        cond: {
                          $eq: [
                            "$$r.reason",
                            "defective",
                          ],
                        },
                      },
                    },
                    as: "r",
                    in: {
                      $ifNull: ["$$r.qty", 0],
                    },
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
                    cond: {
                      $eq: [
                        "$$r.reason",
                        "quality_issue",
                      ],
                    },
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
                        cond: {
                          $eq: [
                            "$$r.reason",
                            "quality_issue",
                          ],
                        },
                      },
                    },
                    as: "r",
                    in: {
                      $ifNull: ["$$r.qty", 0],
                    },
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
                    cond: {
                      $eq: [
                        "$$r.reason",
                        "changed_mind",
                      ],
                    },
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
                        cond: {
                          $eq: [
                            "$$r.reason",
                            "changed_mind",
                          ],
                        },
                      },
                    },
                    as: "r",
                    in: {
                      $ifNull: ["$$r.qty", 0],
                    },
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
                    cond: {
                      $eq: [
                        "$$r.reason",
                        "other",
                      ],
                    },
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
                        cond: {
                          $eq: [
                            "$$r.reason",
                            "other",
                          ],
                        },
                      },
                    },
                    as: "r",
                    in: {
                      $ifNull: ["$$r.qty", 0],
                    },
                  },
                },
              },
            },
          },

          /* NO 10 ITEM LIMIT */
          recentRmas: {
            $sortArray: {
              input: "$recentRmas",
              sortBy: {
                rmaCreatedAt: -1,
              },
            },
          },
        },
      },

      /* =====================================================
         RESPONSE
         DESCRIPTION INTENTIONALLY REMOVED
      ===================================================== */
      {
        $project: {
          _id: 0,

          productId: 1,
          productCode: 1,
          title: 1,
          image: 1,
          price: 1,

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
          [sortBy]:
            sortOrder === "asc" ? 1 : -1,
          productCode: 1,
        },
      },

      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
          ],

          meta: [
            { $count: "total" },
          ],
        },
      },
    ];

    const [result] =
      await Order.aggregate(pipeline);

    const rows = result?.data || [];
    const total =
      result?.meta?.[0]?.total || 0;

    return res.status(200).json({
      success: true,

      message:
        "RMA reasons grouped by product code fetched successfully",

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
        totalPages:
          Math.ceil(total / limit) || 1,

        hasNextPage:
          skip + rows.length < total,

        hasPrevPage:
          page > 1,
      },

      data: rows,
    });
  } catch (error) {
    console.error(
      "getRmaReasonsGroupedByProductCode error:",
      error,
    );

    return res.status(500).json({
      success: false,

      message:
        "Failed to fetch RMA reasons grouped by product code",

      error: error.message,
    });
  }
};
