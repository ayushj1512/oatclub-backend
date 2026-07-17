import mongoose from "mongoose";

import CuttingBatch from "./cuttingbatch.js";
import InventoryReservation from "../InventoryReservation/InventoryReservation.js";
import Order from "../Orders/Orders.js";
import VendorUser from "../VendorUser/VendorUser.js";

const ALLOWED_SOURCES = ["shopify", "website"];

/* =========================================================
   HELPERS
========================================================= */

const normalizeSource = (value) => {
  const source = String(value || "website")
    .trim()
    .toLowerCase();

  return ALLOWED_SOURCES.includes(source)
    ? source
    : "website";
};

const normalizeCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

const getOrderSequence = (orderNumber = "") => {
  const match = String(orderNumber).match(/(\d+)$/);

  return match ? Number(match[1]) : 0;
};

const getSizeKey = (value = "") => {
  const size = String(value)
    .trim()
    .toLowerCase();

  if (size === "xs") return "xs";
  if (size === "s") return "s";
  if (size === "m") return "m";
  if (size === "l") return "l";
  if (size === "xl") return "xl";

  return null;
};

const createBatchNumber = (
  vendorId,
  source = "website"
) => {
  const date = new Date()
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "");

  const sourcePrefix =
    source === "shopify"
      ? "SHOP"
      : "WEB";

  const vendorSuffix = String(vendorId)
    .slice(-6)
    .toUpperCase();

  return `VCUT-${sourcePrefix}-${vendorSuffix}-${date}-${Date.now()}`;
};

const getAssignmentProductId = (assignment) =>
  String(
    assignment?.product?._id ||
      assignment?.product ||
      ""
  ).trim();

const getVendorAccess = async (req) => {
  const vendorId = req.vendor?._id;

  if (
    !vendorId ||
    !mongoose.Types.ObjectId.isValid(vendorId)
  ) {
    return {
      success: false,
      status: 401,
      message: "Vendor authentication required",
    };
  }

  const vendor = await VendorUser.findById(vendorId)
    .select(
      "name isActive modules assignedProducts"
    )
    .populate({
      path: "assignedProducts.product",
      select: "productCode title",
    })
    .lean();

  if (!vendor || !vendor.isActive) {
    return {
      success: false,
      status: 403,
      message: "Vendor account is disabled",
    };
  }

  if (
    vendor.modules?.cuttingList !== true
  ) {
    return {
      success: false,
      status: 403,
      message:
        "Cutting list module access denied",
    };
  }

  const assignments = (
    vendor.assignedProducts || []
  ).filter(
    (assignment) =>
      assignment?.modules?.cuttingList ===
        true &&
      assignment?.product
  );

  const productIds = [
    ...new Set(
      assignments
        .map(getAssignmentProductId)
        .filter((id) =>
          mongoose.Types.ObjectId.isValid(id)
        )
    ),
  ].map(
    (id) =>
      new mongoose.Types.ObjectId(id)
  );

  const productCodes = [
    ...new Set(
      assignments
        .map((assignment) =>
          normalizeCode(
            assignment?.product?.productCode
          )
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

const buildReservationAccessFilter = ({
  productIds,
  productCodes,
}) => {
  const accessConditions = [];

  if (productIds.length) {
    accessConditions.push({
      productId: {
        $in: productIds,
      },
    });
  }

  if (productCodes.length) {
    accessConditions.push({
      productCode: {
        $in: productCodes,
      },
    });
  }

  return accessConditions.length
    ? {
        $or: accessConditions,
      }
    : {
        _id: null,
      };
};

const filterBatchRows = (
  rows = [],
  allowedCodes = []
) => {
  const allowedSet = new Set(
    allowedCodes.map(normalizeCode)
  );

  return (Array.isArray(rows) ? rows : []).filter(
    (row) =>
      allowedSet.has(
        normalizeCode(row?.productCode)
      )
  );
};

const serializeVendorBatch = (
  batch,
  allowedCodes
) => {
  if (!batch) return null;

  const rows = filterBatchRows(
    batch.rows,
    allowedCodes
  );

  const totalPieces = rows.reduce(
    (sum, row) =>
      sum + Number(row?.totalQty || 0),
    0
  );

  return {
    ...batch,
    rows,
    totalPieces,
    totalProducts: rows.length,
  };
};

/* =========================================================
   GENERATE VENDOR CUTTING BATCH
   POST /api/cutting-batches/vendor
========================================================= */

export const generateVendorCuttingBatch = async (
  req,
  res
) => {
  try {
    const access = await getVendorAccess(req);

    if (!access.success) {
      return res
        .status(access.status)
        .json({
          success: false,
          message: access.message,
        });
    }

    if (
      !access.productIds.length &&
      !access.productCodes.length
    ) {
      return res.status(400).json({
        success: false,
        message:
          "No products are assigned for cutting",
      });
    }

    const source = normalizeSource(
      req.body?.source ||
        req.query?.source
    );

    const lastBatch =
      await CuttingBatch.findOne({
        source,
        "logs.action":
          "vendor_cutting_batch",
        "logs.message": {
          $regex: String(
            access.vendor._id
          ),
        },
      })
        .sort({
          createdAt: -1,
        })
        .lean();

    const lastSequence = lastBatch
      ? getOrderSequence(
          lastBatch.toOrderNumber
        )
      : 0;

    const orders = await Order.find({
      source,
      orderNumber: {
        $exists: true,
        $ne: "",
      },
      fulfillmentStatus: {
        $nin: [
          "cancelled",
          "rto",
          "delivered",
        ],
      },
    })
      .select("_id orderNumber")
      .lean();

    const newOrders = orders
      .filter(
        (order) =>
          getOrderSequence(
            order.orderNumber
          ) > lastSequence
      )
      .sort(
        (a, b) =>
          getOrderSequence(
            a.orderNumber
          ) -
          getOrderSequence(
            b.orderNumber
          )
      );

    if (!newOrders.length) {
      return res.status(400).json({
        success: false,
        message: lastBatch
          ? `No new ${source} orders found after ${lastBatch.toOrderNumber}`
          : `No ${source} orders found for cutting`,
      });
    }

    const orderIds = newOrders.map(
      (order) => order._id
    );

    const reservations =
      await InventoryReservation.find({
        refType: "order",
        status: "pending",
        refId: {
          $in: orderIds,
        },
        ...buildReservationAccessFilter({
          productIds: access.productIds,
          productCodes:
            access.productCodes,
        }),
      }).lean();

    if (!reservations.length) {
      return res.status(400).json({
        success: false,
        message:
          "No pending reservations found for assigned cutting products",
      });
    }

    const validOrderNumbers = new Set(
      reservations
        .map((item) => item.orderNumber)
        .filter(Boolean)
    );

    const validOrders = newOrders.filter(
      (order) =>
        validOrderNumbers.has(
          order.orderNumber
        )
    );

    const firstOrder =
      validOrders[0] || newOrders[0];

    const lastOrder =
      validOrders[
        validOrders.length - 1
      ] ||
      newOrders[newOrders.length - 1];

    const grouped = {};

    for (const item of reservations) {
      const productCode = normalizeCode(
        item.productCode
      );

      const key =
        productCode ||
        item.variantSku ||
        item.productTitle ||
        String(item.productId);

      if (!grouped[key]) {
        grouped[key] = {
          productTitle:
            item.productTitle || "",

          productCode:
            item.productCode || "",

          productImage:
            item.productImage || "",

          xs: 0,
          s: 0,
          m: 0,
          l: 0,
          xl: 0,
          totalQty: 0,
        };
      }

      const size = getSizeKey(
        item.selectedSize
      );

      const quantity = Number(
        item.qty || 0
      );

      if (size) {
        grouped[key][size] += quantity;
      }

      grouped[key].totalQty += quantity;
    }

    const rows = Object.values(
      grouped
    ).sort((a, b) =>
      String(
        a.productCode || ""
      ).localeCompare(
        String(b.productCode || ""),
        undefined,
        {
          numeric: true,
        }
      )
    );

    const totalPieces = rows.reduce(
      (sum, row) =>
        sum + Number(row.totalQty || 0),
      0
    );

    const batch =
      await CuttingBatch.create({
        batchNumber: createBatchNumber(
          access.vendor._id,
          source
        ),

        source,

        fromOrderNumber:
          firstOrder.orderNumber,

        toOrderNumber:
          lastOrder.orderNumber,

        totalOrders:
          validOrders.length,

        totalPieces,

        rows,

        logs: [
          {
            action:
              "vendor_cutting_batch",

            message: `Vendor ${access.vendor._id} cutting batch`,
          },
          {
            action: "created",

            message: `Vendor cutting batch created from ${firstOrder.orderNumber} to ${lastOrder.orderNumber}`,
          },
          {
            action:
              "reservations_grouped",

            message: `${reservations.length} reservations grouped into ${rows.length} assigned product rows`,
          },
        ],
      });

    return res.status(201).json({
      success: true,
      message:
        "Vendor cutting batch generated successfully",
      batch,
    });
  } catch (error) {
    console.error(
      "generateVendorCuttingBatch error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Failed to generate vendor cutting batch",
    });
  }
};

/* =========================================================
   GET VENDOR CUTTING BATCHES
   GET /api/cutting-batches/vendor
========================================================= */

export const getVendorCuttingBatches = async (
  req,
  res
) => {
  try {
    const access = await getVendorAccess(req);

    if (!access.success) {
      return res
        .status(access.status)
        .json({
          success: false,
          message: access.message,
        });
    }

    const source = req.query.source
      ? normalizeSource(req.query.source)
      : null;

    const filters = {
      "logs.action":
        "vendor_cutting_batch",

      "logs.message": {
        $regex: String(access.vendor._id),
      },

      ...(source ? { source } : {}),
    };

    const batches =
      await CuttingBatch.find(filters)
        .sort({
          createdAt: -1,
        })
        .lean();

    const filteredBatches = batches
      .map((batch) =>
        serializeVendorBatch(
          batch,
          access.productCodes
        )
      )
      .filter(
        (batch) =>
          batch?.rows?.length > 0
      );

    return res.status(200).json({
      success: true,
      batches: filteredBatches,
      total: filteredBatches.length,
    });
  } catch (error) {
    console.error(
      "getVendorCuttingBatches error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Failed to fetch vendor cutting batches",
    });
  }
};

/* =========================================================
   GET ONE VENDOR CUTTING BATCH
   GET /api/cutting-batches/vendor/:id
========================================================= */

export const getVendorCuttingBatchById = async (
  req,
  res
) => {
  try {
    const access = await getVendorAccess(req);

    if (!access.success) {
      return res
        .status(access.status)
        .json({
          success: false,
          message: access.message,
        });
    }

    const { id } = req.params;

    if (
      !mongoose.Types.ObjectId.isValid(id)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid cutting batch ID",
      });
    }

    const batch =
      await CuttingBatch.findOne({
        _id: id,

        "logs.action":
          "vendor_cutting_batch",

        "logs.message": {
          $regex: String(
            access.vendor._id
          ),
        },
      }).lean();

    if (!batch) {
      return res.status(404).json({
        success: false,
        message:
          "Vendor cutting batch not found",
      });
    }

    const filteredBatch =
      serializeVendorBatch(
        batch,
        access.productCodes
      );

    if (!filteredBatch.rows.length) {
      return res.status(403).json({
        success: false,
        message:
          "No assigned products available in this batch",
      });
    }

    return res.status(200).json({
      success: true,
      batch: filteredBatch,
    });
  } catch (error) {
    console.error(
      "getVendorCuttingBatchById error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Failed to fetch vendor cutting batch",
    });
  }
};