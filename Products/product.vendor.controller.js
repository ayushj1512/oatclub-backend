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
  String(
    assignment?.product?._id ||
      assignment?.product ||
      ""
  );

const getVendorWithAssignments = async (vendorId) => {
  if (!isValidObjectId(vendorId)) return null;

  return VendorUser.findById(vendorId)
    .select("modules assignedProducts isActive")
    .lean();
};

const getAllowedProductIds = (
  vendor,
  moduleName
) => {
  if (
    !vendor?.isActive ||
    vendor?.modules?.[moduleName] !== true
  ) {
    return [];
  }

  return [
    ...new Set(
      (vendor.assignedProducts || [])
        .filter(
          (assignment) =>
            assignment?.modules?.[moduleName] === true
        )
        .map(getAssignmentProductId)
        .filter(isValidObjectId)
    ),
  ];
};

const getVendorAccess = async (
  req,
  moduleName
) => {
  const vendorId =
    req.vendor?._id ||
    req.vendor?.id;

  const vendor =
    await getVendorWithAssignments(vendorId);

  if (!vendor) {
    return {
      success: false,
      status: 401,
      message: "Vendor not authorized",
      vendor: null,
      productIds: [],
    };
  }

  if (!vendor.isActive) {
    return {
      success: false,
      status: 403,
      message: "Vendor account is disabled",
      vendor,
      productIds: [],
    };
  }

  if (vendor.modules?.[moduleName] !== true) {
    return {
      success: false,
      status: 403,
      message: `${moduleName} module access denied`,
      vendor,
      productIds: [],
    };
  }

  return {
    success: true,
    status: 200,
    vendor,
    productIds: getAllowedProductIds(
      vendor,
      moduleName
    ),
  };
};

const hasAssignedProductAccess = (
  productIds,
  productId
) =>
  productIds.some(
    (allowedId) =>
      String(allowedId) ===
      String(productId)
  );

/* =========================================================
   VENDOR SAMPLING
========================================================= */

export const getVendorSamplingProducts = async (
  req,
  res
) => {
  try {
    const access = await getVendorAccess(
      req,
      "sampling"
    );

    if (!access.success) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const page = toPositiveInt(
      req.query.page,
      1
    );

    const limit = Math.min(
      toPositiveInt(req.query.limit, 20),
      100
    );

    const skip = (page - 1) * limit;

    const search = String(
      req.query.search || ""
    ).trim();

    const status = String(
      req.query.status || "all"
    )
      .trim()
      .toLowerCase();

    const productCode = String(
      req.query.productCode || ""
    ).trim();

    if (!access.productIds.length) {
      return res.json({
        success: true,
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
      _id: {
        $in: access.productIds,
      },
      isActive: true,
      isDraft: {
        $ne: true,
      },
    };

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

      query.$or = [
        { title: regex },
        { productCode: regex },
      ];
    }

    const [products, total] =
      await Promise.all([
        Product.find(query)
          .select(productSelect)
          .sort({
            isSamplingDone: 1,
            updatedAt: -1,
          })
          .skip(skip)
          .limit(limit)
          .lean(),

        Product.countDocuments(query),
      ]);

    const samples = products.map(
      (product) => ({
        ...product,
        status:
          normalizeSamplingStatus(product),
        samplingStatus:
          normalizeSamplingStatus(product),
      })
    );

    const pages = Math.max(
      Math.ceil(total / limit),
      1
    );

    return res.json({
      success: true,
      samples,
      page,
      limit,
      total,
      pages,
      hasNextPage: page < pages,
      hasPrevPage: page > 1,
    });
  } catch (error) {
    console.error(
      "getVendorSamplingProducts error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch sampling products",
    });
  }
};

export const updateVendorSamplingStatus = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const access = await getVendorAccess(
      req,
      "sampling"
    );

    if (!access.success) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    if (
      !hasAssignedProductAccess(
        access.productIds,
        id
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "This product is not assigned for sampling",
      });
    }

    const rawStatus = String(
      req.body.status ||
        req.body.samplingStatus ||
        ""
    )
      .trim()
      .toLowerCase();

    if (
      !["done", "pending"].includes(
        rawStatus
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Status must be done or pending",
      });
    }

    const product =
      await Product.findOneAndUpdate(
        {
          _id: id,
          isActive: true,
          isDraft: {
            $ne: true,
          },
        },
        {
          $set: {
            isSamplingDone:
              rawStatus === "done",
          },
        },
        {
          new: true,
          runValidators: true,
        }
      )
        .select(productSelect)
        .lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message:
          "Assigned product not found",
      });
    }

    const sample = {
      ...product,
      status:
        normalizeSamplingStatus(product),
      samplingStatus:
        normalizeSamplingStatus(product),
    };

    return res.json({
      success: true,
      message:
        "Sampling status updated",
      sample,
    });
  } catch (error) {
    console.error(
      "updateVendorSamplingStatus error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to update sampling status",
    });
  }
};

export const addVendorSamplingRemark = async (
  req,
  res
) => {
  return res.status(400).json({
    success: false,
    message:
      "Sampling remark field is not available in Product schema yet",
  });
};

/* =========================================================
   VENDOR PATTERN
========================================================= */

export const getVendorPatternProducts = async (
  req,
  res
) => {
  try {
    const access = await getVendorAccess(
      req,
      "pattern"
    );

    if (!access.success) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const page = toPositiveInt(
      req.query.page,
      1
    );

    const limit = Math.min(
      toPositiveInt(req.query.limit, 20),
      100
    );

    const skip = (page - 1) * limit;

    const search = String(
      req.query.search || ""
    ).trim();

    const status = String(
      req.query.status || "all"
    )
      .trim()
      .toLowerCase();

    const productCode = String(
      req.query.productCode || ""
    ).trim();

    const patternNumber = String(
      req.query.patternNumber || ""
    ).trim();

    if (!access.productIds.length) {
      return res.json({
        success: true,
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
      _id: {
        $in: access.productIds,
      },
      isActive: true,
      isDraft: {
        $ne: true,
      },
    };

    if (
      status === "ready" ||
      status === "done"
    ) {
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
        $regex:
          escapeRegex(patternNumber),
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
        {
          "variants.patternNumber": regex,
        },
      ];
    }

    const [products, total] =
      await Promise.all([
        Product.find(query)
          .select(productSelect)
          .sort({
            isPatternReady: 1,
            updatedAt: -1,
          })
          .skip(skip)
          .limit(limit)
          .lean(),

        Product.countDocuments(query),
      ]);

    const patterns = products.map(
      (product) => ({
        ...product,
        status:
          normalizePatternStatus(product),
        patternStatus:
          normalizePatternStatus(product),
      })
    );

    const pages = Math.max(
      Math.ceil(total / limit),
      1
    );

    return res.json({
      success: true,
      patterns,
      page,
      limit,
      total,
      pages,
      hasNextPage: page < pages,
      hasPrevPage: page > 1,
    });
  } catch (error) {
    console.error(
      "getVendorPatternProducts error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch pattern jobs",
    });
  }
};

export const updateVendorPatternStatus = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const access = await getVendorAccess(
      req,
      "pattern"
    );

    if (!access.success) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    if (
      !hasAssignedProductAccess(
        access.productIds,
        id
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "This product is not assigned for pattern work",
      });
    }

    const rawStatus = String(
      req.body.status ||
        req.body.patternStatus ||
        ""
    )
      .trim()
      .toLowerCase();

    if (
      ![
        "ready",
        "done",
        "pending",
      ].includes(rawStatus)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Status must be ready, done or pending",
      });
    }

    const isReady =
      rawStatus === "ready" ||
      rawStatus === "done";

    const product =
      await Product.findOneAndUpdate(
        {
          _id: id,
          isActive: true,
          isDraft: {
            $ne: true,
          },
        },
        {
          $set: {
            isPatternReady: isReady,
          },
        },
        {
          new: true,
          runValidators: true,
        }
      )
        .select(productSelect)
        .lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message:
          "Assigned product not found",
      });
    }

    const pattern = {
      ...product,
      status:
        normalizePatternStatus(product),
      patternStatus:
        normalizePatternStatus(product),
    };

    return res.json({
      success: true,
      message:
        "Pattern status updated",
      pattern,
    });
  } catch (error) {
    console.error(
      "updateVendorPatternStatus error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to update pattern status",
    });
  }
};