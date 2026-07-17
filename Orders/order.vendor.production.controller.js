import mongoose from "mongoose";
import ExcelJS from "exceljs";

import InventoryReservation from "../InventoryReservation/InventoryReservation.js";
import VendorUser from "../VendorUser/VendorUser.js";

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toPositiveInt = (value, fallback) => {
  const number = Number(value);

  return Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : fallback;
};

const parseBoolean = (value) =>
  ["true", "1", "yes"].includes(
    String(value || "").trim().toLowerCase()
  );

const buildDateRange = (from, to) => {
  const range = {};

  if (from) {
    const date = new Date(`${from}T00:00:00.000+05:30`);

    if (!Number.isNaN(date.getTime())) {
      range.$gte = date;
    }
  }

  if (to) {
    const date = new Date(`${to}T23:59:59.999+05:30`);

    if (!Number.isNaN(date.getTime())) {
      range.$lte = date;
    }
  }

  return Object.keys(range).length ? range : null;
};

const buildSort = (sort = "qty_desc") => {
  switch (String(sort || "").trim()) {
    case "qty_asc":
      return { totalQty: 1, sku: 1 };

    case "sku_asc":
      return { sku: 1 };

    case "sku_desc":
      return { sku: -1 };

    case "title_asc":
      return { productTitle: 1, sku: 1 };

    case "title_desc":
      return { productTitle: -1, sku: 1 };

    case "orders_desc":
      return { ordersCount: -1, totalQty: -1 };

    case "orders_asc":
      return { ordersCount: 1, totalQty: 1 };

    case "qty_desc":
    default:
      return { totalQty: -1, sku: 1 };
  }
};

const getProductId = (assignment) =>
  String(
    assignment?.product?._id ||
      assignment?.product ||
      ""
  ).trim();

const getVendorProductionAccess = async (req) => {
  const vendorId = req.vendor?._id;

  if (!mongoose.Types.ObjectId.isValid(vendorId)) {
    return {
      success: false,
      status: 401,
      message: "Vendor authentication required",
    };
  }

  const vendor = await VendorUser.findById(vendorId)
    .select("isActive modules assignedProducts")
    .populate({
      path: "assignedProducts.product",
      select: "productCode",
    })
    .lean();

  if (!vendor || !vendor.isActive) {
    return {
      success: false,
      status: 403,
      message: "Vendor account is not active",
    };
  }

  if (vendor.modules?.production !== true) {
    return {
      success: false,
      status: 403,
      message: "Production module access denied",
    };
  }

  const assignments = (vendor.assignedProducts || []).filter(
    (assignment) =>
      assignment?.modules?.production === true &&
      assignment?.product
  );

  const productIds = [
    ...new Set(
      assignments
        .map(getProductId)
        .filter((id) =>
          mongoose.Types.ObjectId.isValid(id)
        )
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));

  const productCodes = [
    ...new Set(
      assignments
        .map((assignment) =>
          String(
            assignment?.product?.productCode || ""
          )
            .trim()
            .toUpperCase()
        )
        .filter(Boolean)
    ),
  ];

  return {
    success: true,
    vendor,
    productIds,
    productCodes,
  };
};

const buildVendorProductMatch = ({
  productIds = [],
  productCodes = [],
}) => {
  const conditions = [];

  if (productIds.length) {
    conditions.push({
      productId: {
        $in: productIds,
      },
    });
  }

  if (productCodes.length) {
    conditions.push({
      productCode: {
        $in: productCodes,
      },
    });
  }

  return conditions.length
    ? { $or: conditions }
    : { _id: null };
};

const buildPipeline = ({
  productIds,
  productCodes,
  search = "",
  from,
  to,
}) => {
  const dateRange = buildDateRange(from, to);

  const baseMatch = {
    refType: "order",
    status: "pending",
    ...buildVendorProductMatch({
      productIds,
      productCodes,
    }),
    ...(dateRange
      ? {
          createdAt: dateRange,
        }
      : {}),
  };

  const pipeline = [
    {
      $match: baseMatch,
    },

    {
      $lookup: {
        from: "orders",
        localField: "refId",
        foreignField: "_id",
        as: "order",
      },
    },

    {
      $unwind: {
        path: "$order",
        preserveNullAndEmptyArrays: false,
      },
    },

    {
      $match: {
        "order.isConfirmed": true,
      },
    },
  ];

  if (search) {
    const regex = new RegExp(
      escapeRegex(search),
      "i"
    );

    pipeline.push({
      $match: {
        $or: [
          { variantSku: regex },
          { productCode: regex },
          { productTitle: regex },
          { orderNumber: regex },
          { selectedSize: regex },
          { selectedColor: regex },
        ],
      },
    });
  }

  pipeline.push(
    {
      $addFields: {
        effectiveSku: {
          $cond: [
            {
              $gt: [
                {
                  $strLenCP: {
                    $ifNull: [
                      "$variantSku",
                      "",
                    ],
                  },
                },
                0,
              ],
            },
            "$variantSku",
            "$productCode",
          ],
        },
      },
    },

    {
      $group: {
        _id: {
          sku: "$effectiveSku",
        },

        sku: {
          $first: "$effectiveSku",
        },

        productId: {
          $first: "$productId",
        },

        variantId: {
          $first: "$variantId",
        },

        productCode: {
          $first: "$productCode",
        },

        productTitle: {
          $first: "$productTitle",
        },

        productImage: {
          $first: "$productImage",
        },

        totalQty: {
          $sum: "$qty",
        },

        orderIds: {
          $addToSet: "$refId",
        },

        orderNumbers: {
          $addToSet: "$orderNumber",
        },

        reservationsCount: {
          $sum: 1,
        },

        sizes: {
          $push: {
            size: "$selectedSize",
            qty: "$qty",
          },
        },

        colors: {
          $push: {
            color: "$selectedColor",
            qty: "$qty",
          },
        },

        rawReservations: {
          $push: {
            reservationId: "$_id",
            orderId: "$refId",
            orderNumber: "$orderNumber",
            qty: "$qty",
            selectedSize: "$selectedSize",
            selectedColor: "$selectedColor",
            variantSku: "$variantSku",
            productCode: "$productCode",
            createdAt: "$createdAt",
          },
        },

        latestCreatedAt: {
          $max: "$createdAt",
        },
      },
    },

    {
      $addFields: {
        ordersCount: {
          $size: "$orderIds",
        },
      },
    },

    {
      $project: {
        _id: 0,
        sku: 1,
        productId: 1,
        variantId: 1,
        productCode: 1,
        productTitle: 1,
        productImage: 1,
        totalQty: 1,
        ordersCount: 1,
        reservationsCount: 1,
        sizes: 1,
        colors: 1,
        orderNumbers: 1,
        rawReservations: 1,
        latestCreatedAt: 1,
      },
    }
  );

  return pipeline;
};

const fetchVendorProductionData = async ({
  req,
  fetchAll = false,
}) => {
  const access =
    await getVendorProductionAccess(req);

  if (!access.success) {
    return {
      error: access,
    };
  }

  const search = String(
    req.query.q || ""
  ).trim();

  const page = toPositiveInt(
    req.query.page,
    1
  );

  const limit = Math.min(
    toPositiveInt(req.query.limit, 50),
    5000
  );

  const wantsAll =
    fetchAll ||
    parseBoolean(req.query.all) ||
    String(req.query.limit) === "0";

  const skip = (page - 1) * limit;

  const pipeline = buildPipeline({
    productIds: access.productIds,
    productCodes: access.productCodes,
    search,
    from: req.query.from,
    to: req.query.to,
  });

  const sort = buildSort(req.query.sort);

  const [rows, totalResult, summaryResult] =
    await Promise.all([
      InventoryReservation.aggregate([
        ...pipeline,
        {
          $sort: sort,
        },
        ...(wantsAll
          ? []
          : [
              {
                $skip: skip,
              },
              {
                $limit: limit,
              },
            ]),
      ]),

      InventoryReservation.aggregate([
        ...pipeline,
        {
          $count: "total",
        },
      ]),

      InventoryReservation.aggregate([
        ...pipeline,
        {
          $group: {
            _id: null,
            totalSkus: {
              $sum: 1,
            },
            totalQtyToProduce: {
              $sum: "$totalQty",
            },
            totalOrdersCovered: {
              $sum: "$ordersCount",
            },
            totalReservations: {
              $sum: "$reservationsCount",
            },
          },
        },
      ]),
    ]);

  const total =
    Number(totalResult?.[0]?.total) || 0;

  const pages = wantsAll
    ? 1
    : Math.max(
        Math.ceil(total / limit),
        1
      );

  return {
    rows,
    summary: {
      totalSkus:
        Number(
          summaryResult?.[0]?.totalSkus
        ) || 0,

      totalQtyToProduce:
        Number(
          summaryResult?.[0]
            ?.totalQtyToProduce
        ) || 0,

      totalOrdersCovered:
        Number(
          summaryResult?.[0]
            ?.totalOrdersCovered
        ) || 0,

      totalReservations:
        Number(
          summaryResult?.[0]
            ?.totalReservations
        ) || 0,
    },

    pagination: {
      total,
      page: wantsAll ? 1 : page,
      limit: wantsAll
        ? rows.length
        : limit,
      pages,
      hasMore:
        !wantsAll && page < pages,
    },
  };
};

/* =========================================================
   VENDOR PRODUCTION JOBS
========================================================= */

export const getVendorProductionJobs = async (
  req,
  res
) => {
  try {
    const result =
      await fetchVendorProductionData({
        req,
      });

    if (result.error) {
      return res
        .status(result.error.status)
        .json({
          success: false,
          message: result.error.message,
        });
    }

    return res.status(200).json({
      success: true,
      message:
        "Vendor production jobs fetched successfully",
      ...result,
    });
  } catch (error) {
    console.error(
      "getVendorProductionJobs error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch vendor production jobs",
    });
  }
};

/* =========================================================
   EXPORT VENDOR PRODUCTION JOBS
========================================================= */

export const exportVendorProductionJobs = async (
  req,
  res
) => {
  try {
    const result =
      await fetchVendorProductionData({
        req,
        fetchAll: true,
      });

    if (result.error) {
      return res
        .status(result.error.status)
        .json({
          success: false,
          message: result.error.message,
        });
    }

    const workbook =
      new ExcelJS.Workbook();

    workbook.creator = "OATCLUB";

    const sheet = workbook.addWorksheet(
      "Production Jobs"
    );

    sheet.columns = [
      {
        header: "Product",
        key: "productTitle",
        width: 35,
      },
      {
        header: "Product Code",
        key: "productCode",
        width: 18,
      },
      {
        header: "SKU",
        key: "sku",
        width: 22,
      },
      {
        header: "Quantity",
        key: "totalQty",
        width: 12,
      },
      {
        header: "Orders",
        key: "ordersCount",
        width: 12,
      },
      {
        header: "Sizes",
        key: "sizes",
        width: 35,
      },
      {
        header: "Colors",
        key: "colors",
        width: 35,
      },
    ];

    sheet.getRow(1).font = {
      bold: true,
    };

    result.rows.forEach((job) => {
      const sizes = (job.sizes || [])
        .map(
          (item) =>
            `${item.size || "NA"}: ${
              item.qty || 0
            }`
        )
        .join(", ");

      const colors = (job.colors || [])
        .map(
          (item) =>
            `${item.color || "NA"}: ${
              item.qty || 0
            }`
        )
        .join(", ");

      sheet.addRow({
        productTitle:
          job.productTitle || "",
        productCode:
          job.productCode || "",
        sku: job.sku || "",
        totalQty: job.totalQty || 0,
        ordersCount:
          job.ordersCount || 0,
        sizes,
        colors,
      });
    });

    sheet.eachRow((row) => {
      row.alignment = {
        vertical: "middle",
        wrapText: true,
      };
    });

    const fileName =
      `oatclub-vendor-production-${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    await workbook.xlsx.write(res);

    return res.end();
  } catch (error) {
    console.error(
      "exportVendorProductionJobs error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to export vendor production jobs",
    });
  }
};