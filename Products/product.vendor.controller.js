import mongoose from "mongoose";

import Product from "./Products.js";
import VendorUser from "../VendorUser/VendorUser.js";

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const productSelect = [
  "title",
  "slug",
  "productCode",
  "thumbnail",
  "images",
  "isActive",
  "isDraft",
  "isSamplingDone",
  "isPatternReady",
  "variants",
  "createdAt",
  "updatedAt",
].join(" ");

const isValidObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(String(value || "").trim());

const toPositiveInt = (value, fallback) => {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.floor(number);
};

const normalizePatternStatus = (product) =>
  product?.isPatternReady ? "ready" : "pending";

const normalizeSamplingStatus = (product) =>
  product?.isSamplingDone ? "done" : "pending";

const getAssignmentProductId = (assignment) =>
  String(assignment?.product?._id || assignment?.product || "");

const getVendorWithAssignments = async (vendorId) => {
  if (!isValidObjectId(vendorId)) {
    return null;
  }

  return VendorUser.findById(vendorId)
    .select("role modules assignedProducts isActive")
    .lean();
};

const getAllowedProductIds = (vendor, moduleName) => {
  if (!vendor?.isActive) {
    return [];
  }

  // Superadmin ko assigned IDs ki zarurat nahi
  if (vendor.role === "superadmin") {
    return null;
  }

  if (vendor?.modules?.[moduleName] !== true) {
    return [];
  }

  return [
    ...new Set(
      (vendor.assignedProducts || [])
        .filter((assignment) => assignment?.modules?.[moduleName] === true)
        .map(getAssignmentProductId)
        .filter(isValidObjectId),
    ),
  ];
};

const getVendorAccess = async (req, moduleName) => {
  const vendorId = req.vendor?._id || req.vendor?.id;

  const vendor = await getVendorWithAssignments(vendorId);

  if (!vendor) {
    return {
      success: false,
      status: 401,
      message: "Vendor not authorized",
      vendor: null,
      productIds: [],
      isSuperAdmin: false,
    };
  }

  if (!vendor.isActive) {
    return {
      success: false,
      status: 403,
      message: "Vendor account is disabled",
      vendor,
      productIds: [],
      isSuperAdmin: false,
    };
  }

  const isSuperAdmin = vendor.role === "superadmin";

  if (!isSuperAdmin && vendor.modules?.[moduleName] !== true) {
    return {
      success: false,
      status: 403,
      message: `${moduleName} module access denied`,
      vendor,
      productIds: [],
      isSuperAdmin: false,
    };
  }

  return {
    success: true,
    status: 200,
    vendor,
    isSuperAdmin,

    // null means unrestricted/all products
    productIds: isSuperAdmin ? null : getAllowedProductIds(vendor, moduleName),
  };
};

const hasAssignedProductAccess = (productIds, productId) => {
  // null = superadmin = all products allowed
  if (productIds === null) {
    return true;
  }

  return Array.isArray(productIds)
    ? productIds.some((allowedId) => String(allowedId) === String(productId))
    : false;
};

/* =========================================================
   VENDOR SAMPLING
========================================================= */

export const getVendorSamplingProducts = async (req, res) => {
  try {
    const access = await getVendorAccess(req, "sampling");

    if (!access.success) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const page = toPositiveInt(req.query.page, 1);

    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);

    const search = String(req.query.search || "").trim();

    const status = String(req.query.status || "all")
      .trim()
      .toLowerCase();

    const productCode = String(req.query.productCode || "").trim();

    if (!access.isSuperAdmin && !access.productIds.length) {
      return res.json({
        success: true,
        isSuperAdmin: false,
        hasAllProductAccess: false,
        samples: [],
        page: 1,
        limit,
        total: 0,
        pages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });
    }

    const query = {
      isActive: true,
      isDraft: {
        $ne: true,
      },
    };

    if (!access.isSuperAdmin) {
      query._id = {
        $in: access.productIds,
      };
    }

    if (status === "done") {
      query.isSamplingDone = true;
    }

    if (status === "pending") {
      query.isSamplingDone = {
        $ne: true,
      };
    }

    if (productCode) {
      query.productCode = {
        $regex: escapeRegex(productCode),
        $options: "i",
      };
    }

    if (search) {
      const regex = {
        $regex: escapeRegex(search),
        $options: "i",
      };

      query.$or = [{ title: regex }, { productCode: regex }, { slug: regex }];
    }

    const total = await Product.countDocuments(query);

    const pages = Math.max(Math.ceil(total / limit), 1);

    const safePage = Math.min(page, pages);

    const skip = (safePage - 1) * limit;

    const products = await Product.find(query)
      .select(productSelect)
      .sort({
        isSamplingDone: 1,
        updatedAt: -1,
      })
      .skip(skip)
      .limit(limit)
      .lean();

    const samples = products.map((product) => {
      const samplingStatus = normalizeSamplingStatus(product);

      return {
        ...product,
        status: samplingStatus,
        samplingStatus,
      };
    });

    return res.json({
      success: true,

      isSuperAdmin: access.isSuperAdmin,

      hasAllProductAccess: access.isSuperAdmin,

      samples,

      page: safePage,
      limit,
      total,
      pages,

      hasNextPage: safePage < pages,

      hasPrevPage: safePage > 1,
    });
  } catch (error) {
    console.error("getVendorSamplingProducts error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch sampling products",
    });
  }
};

export const updateVendorSamplingStatus = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const access = await getVendorAccess(req, "sampling");

    if (!access.success) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    if (!hasAssignedProductAccess(access.productIds, id)) {
      return res.status(403).json({
        success: false,
        message: "This product is not assigned for sampling",
      });
    }

    const rawStatus = String(req.body.status || req.body.samplingStatus || "")
      .trim()
      .toLowerCase();

    if (!["done", "pending"].includes(rawStatus)) {
      return res.status(400).json({
        success: false,
        message: "Status must be done or pending",
      });
    }

    const product = await Product.findOneAndUpdate(
      {
        _id: id,
        isActive: true,
        isDraft: {
          $ne: true,
        },
      },
      {
        $set: {
          isSamplingDone: rawStatus === "done",
        },
      },
      {
        new: true,
        runValidators: true,
      },
    )
      .select(productSelect)
      .lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const samplingStatus = normalizeSamplingStatus(product);

    return res.json({
      success: true,
      message: "Sampling status updated",

      sample: {
        ...product,
        status: samplingStatus,
        samplingStatus,
      },
    });
  } catch (error) {
    console.error("updateVendorSamplingStatus error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update sampling status",
    });
  }
};

export const addVendorSamplingRemark = async (req, res) => {
  return res.status(400).json({
    success: false,
    message: "Sampling remark field is not available in Product schema yet",
  });
};

/* =========================================================
   VENDOR PATTERN
========================================================= */

export const getVendorPatternProducts = async (req, res) => {
  try {
    const access = await getVendorAccess(req, "pattern");

    if (!access.success) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const page = toPositiveInt(req.query.page, 1);

    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);

    const search = String(req.query.search || "").trim();

    const status = String(req.query.status || "all")
      .trim()
      .toLowerCase();

    const productCode = String(req.query.productCode || "").trim();

    const patternNumber = String(req.query.patternNumber || "").trim();

    if (!access.isSuperAdmin && !access.productIds.length) {
      return res.json({
        success: true,
        isSuperAdmin: false,
        hasAllProductAccess: false,
        patterns: [],
        page: 1,
        limit,
        total: 0,
        pages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });
    }

    const query = {
      isActive: true,
      isDraft: {
        $ne: true,
      },
    };

    if (!access.isSuperAdmin) {
      query._id = {
        $in: access.productIds,
      };
    }

    if (status === "ready" || status === "done") {
      query.isPatternReady = true;
    }

    if (status === "pending") {
      query.isPatternReady = {
        $ne: true,
      };
    }

    if (productCode) {
      query.productCode = {
        $regex: escapeRegex(productCode),
        $options: "i",
      };
    }

    if (patternNumber) {
      query["variants.patternNumber"] = {
        $regex: escapeRegex(patternNumber),
        $options: "i",
      };
    }

    if (search) {
      const regex = {
        $regex: escapeRegex(search),
        $options: "i",
      };

      query.$or = [
        { title: regex },
        { productCode: regex },
        { slug: regex },
        {
          "variants.patternNumber": regex,
        },
      ];
    }

    const total = await Product.countDocuments(query);

    const pages = Math.max(Math.ceil(total / limit), 1);

    const safePage = Math.min(page, pages);

    const skip = (safePage - 1) * limit;

    const products = await Product.find(query)
      .select(productSelect)
      .sort({
        isPatternReady: 1,
        updatedAt: -1,
      })
      .skip(skip)
      .limit(limit)
      .lean();

    const patterns = products.map((product) => {
      const patternStatus = normalizePatternStatus(product);

      return {
        ...product,
        status: patternStatus,
        patternStatus,
      };
    });

    return res.json({
      success: true,

      isSuperAdmin: access.isSuperAdmin,

      hasAllProductAccess: access.isSuperAdmin,

      patterns,

      page: safePage,
      limit,
      total,
      pages,

      hasNextPage: safePage < pages,

      hasPrevPage: safePage > 1,
    });
  } catch (error) {
    console.error("getVendorPatternProducts error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch pattern jobs",
    });
  }
};

export const updateVendorPatternStatus = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const access = await getVendorAccess(req, "pattern");

    if (!access.success) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    if (!hasAssignedProductAccess(access.productIds, id)) {
      return res.status(403).json({
        success: false,
        message: "This product is not assigned for pattern work",
      });
    }

    const rawStatus = String(req.body.status || req.body.patternStatus || "")
      .trim()
      .toLowerCase();

    if (!["ready", "done", "pending"].includes(rawStatus)) {
      return res.status(400).json({
        success: false,
        message: "Status must be ready, done or pending",
      });
    }

    const product = await Product.findOneAndUpdate(
      {
        _id: id,
        isActive: true,
        isDraft: {
          $ne: true,
        },
      },
      {
        $set: {
          isPatternReady: rawStatus === "ready" || rawStatus === "done",
        },
      },
      {
        new: true,
        runValidators: true,
      },
    )
      .select(productSelect)
      .lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const patternStatus = normalizePatternStatus(product);

    return res.json({
      success: true,
      message: "Pattern status updated",

      pattern: {
        ...product,
        status: patternStatus,
        patternStatus,
      },
    });
  } catch (error) {
    console.error("updateVendorPatternStatus error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update pattern status",
    });
  }
};

/* =========================================================
   VENDOR BESTSELLER INVENTORY ALERTS
========================================================= */

const getVariantSize = (variant = {}) =>
  String(
    (variant.attributes || []).find(
      (a) => String(a?.key || "").toLowerCase() === "size"
    )?.value || ""
  )
    .trim()
    .toUpperCase();

export const getVendorBestsellerInventoryAlerts = async (req, res) => {
  try {
    const threshold = Math.max(1, Number(req.query.threshold) || 5);

    const products = await Product.find({
      isBestSeller: true,
      isActive: true,
      isDraft: { $ne: true },
    })
      .select(
        "title slug productCode thumbnail images variants stock reservedStock updatedAt"
      )
      .sort({ updatedAt: -1 })
      .lean();

    const alerts = products
      .map((product) => {
        const inventory = (product.variants || [])
          .map((variant) => {
            const size = getVariantSize(variant);
            const stock = Math.max(0, Number(variant.stock) || 0);
            const reservedStock = Math.max(
              0,
              Number(variant.reservedStock) || 0
            );
            const availableStock = Math.max(0, stock - reservedStock);

            return {
              size,
              stock,
              reservedStock,
              availableStock,
              lowStock: availableStock < threshold,
            };
          })
          .filter((item) => item.size);

        const lowStockSizes = inventory
          .filter((item) => item.lowStock)
          .map((item) => item.size);

        return {
          _id: product._id,
          title: product.title,
          productCode: product.productCode,
          thumbnail: product.thumbnail || product.images?.[0] || "",
          inventory,
          lowStockSizes,
          hasLowStock: lowStockSizes.length > 0,
        };
      })
      .filter((product) => product.hasLowStock);

    return res.json({
      success: true,
      threshold,
      total: alerts.length,
      alerts,
    });
  } catch (error) {
    console.error("getVendorBestsellerInventoryAlerts error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch inventory alerts",
    });
  }
};
