import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import VendorUser from "./VendorUser.js";
import Product from "../Products/Products.js";

/* =========================================================
   CONSTANTS
========================================================= */

const VENDOR_MODULES = ["sampling", "pattern", "production", "cuttingList"];

const PRODUCT_SELECT = [
  "_id",
  "title",
  "slug",
  "productCode",
  "thumbnail",
  "images",
  "price",
  "compareAtPrice",
  "categories",
  "isActive",
  "isDraft",
  "isSamplingDone",
  "isPatternReady",
  "variants",
  "createdAt",
  "updatedAt",
].join(" ");

const ALL_VENDOR_MODULES = {
  sampling: true,
  pattern: true,
  production: true,
  cuttingList: true,
};

const isSuperAdminVendor = (vendor) => vendor?.role === "superadmin";

/* =========================================================
   HELPERS
========================================================= */

const generateToken = (vendor) =>
  jwt.sign(
    {
      id: vendor._id,
      role: vendor.role,
      userType: "vendor",
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "30d",
    }
  );

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeString = (value = "") => String(value ?? "").trim();

const normalizeUsername = (value = "") => normalizeString(value).toLowerCase();

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;

  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  return ["true", "1", "yes"].includes(String(value).trim().toLowerCase());
};

const toPositiveInt = (value, fallback) => {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.floor(number);
};

const isValidObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(String(value || "").trim());

const normalizeIds = (values = []) => {
  const list = Array.isArray(values) ? values : [values];

  return [
    ...new Set(
      list
        .map((item) => {
          if (item && typeof item === "object") {
            return String(
              item._id || item.product?._id || item.product || "",
            ).trim();
          }

          return String(item || "").trim();
        })
        .filter(Boolean),
    ),
  ];
};

const normalizeProductCode = (value = "") => {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (!raw) return "";

  if (/^\d+$/.test(raw)) {
    return raw.padStart(5, "0");
  }

  return raw;
};

const normalizeProductCodes = (values = []) => {
  const list = Array.isArray(values) ? values : String(values || "").split(",");

  return [...new Set(list.map(normalizeProductCode).filter(Boolean))];
};

const normalizeVendorModules = (modules = {}, defaults = true) => ({
  sampling: normalizeBoolean(modules?.sampling, defaults),
  pattern: normalizeBoolean(modules?.pattern, defaults),
  production: normalizeBoolean(modules?.production, defaults),
  cuttingList: normalizeBoolean(modules?.cuttingList, defaults),
});

const normalizeAssignmentModules = (modules = []) => {
  if (Array.isArray(modules)) {
    const enabledModules = new Set(
      modules
        .map((moduleName) => String(moduleName || "").trim())
        .filter((moduleName) => VENDOR_MODULES.includes(moduleName)),
    );

    return VENDOR_MODULES.reduce((result, moduleName) => {
      result[moduleName] = enabledModules.has(moduleName);

      return result;
    }, {});
  }

  return VENDOR_MODULES.reduce((result, moduleName) => {
    result[moduleName] = normalizeBoolean(modules?.[moduleName], false);

    return result;
  }, {});
};

const hasAtLeastOneModule = (modules = {}) =>
  VENDOR_MODULES.some((moduleName) => modules?.[moduleName] === true);

const getAssignmentProductId = (assignment) =>
  String(assignment?.product?._id || assignment?.product || "");

const serializeVendor = (vendor) => {
  const data =
    typeof vendor?.toObject === "function"
      ? vendor.toObject()
      : { ...(vendor || {}) };

  delete data.password;

  const superAdmin = data.role === "superadmin";

  const assignedProducts = Array.isArray(data.assignedProducts)
    ? data.assignedProducts
    : [];

  return {
    ...data,

    role: superAdmin ? "superadmin" : "vendor",

    isSuperAdmin: superAdmin,

    hasAllProductAccess: superAdmin,

    modules: superAdmin ? ALL_VENDOR_MODULES : data.modules,

    assignedProducts: superAdmin ? [] : assignedProducts,

    assignedProductCount: superAdmin ? "ALL" : assignedProducts.length,

    productsCount: superAdmin ? "ALL" : assignedProducts.length,
  };
};

const serializeAssignment = (assignment) => {
  const data =
    typeof assignment?.toObject === "function"
      ? assignment.toObject()
      : { ...(assignment || {}) };

  return {
    _id: data._id,
    product: data.product,
    modules: {
      sampling: !!data.modules?.sampling,
      pattern: !!data.modules?.pattern,
      production: !!data.modules?.production,
      cuttingList: !!data.modules?.cuttingList,
    },
    assignedAt: data.assignedAt,
  };
};

const productMatchesStatus = (product, status) => {
  switch (status) {
    case "active":
      return product?.isActive === true && product?.isDraft !== true;

    case "inactive":
      return product?.isActive === false;

    case "draft":
      return product?.isDraft === true;

    case "sampling_done":
      return product?.isSamplingDone === true;

    case "sampling_pending":
      return product?.isSamplingDone !== true;

    case "pattern_ready":
      return product?.isPatternReady === true;

    case "pattern_pending":
      return product?.isPatternReady !== true;

    default:
      return true;
  }
};

/* =========================================================
   CREATE VENDOR USER
   POST /api/vendor-users/create
========================================================= */

export const createVendorUser = async (req, res) => {
  try {
    const {
      name,
      username,
      password,
      phone,
      modules,
      role = "vendor",
    } = req.body;

    const normalizedName = normalizeString(name);

    const normalizedUsername = normalizeUsername(username);

    const normalizedPhone = normalizeString(phone);

    const normalizedRole = role === "superadmin" ? "superadmin" : "vendor";

    if (!normalizedName || !normalizedUsername || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, username and password are required",
      });
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(normalizedUsername)) {
      return res.status(400).json({
        success: false,
        message:
          "Username can only contain letters, numbers, dot, underscore and hyphen",
      });
    }

    if (String(password).length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least 6 characters",
      });
    }

    const existingVendor = await VendorUser.findOne({
      username: normalizedUsername,
    }).lean();

    if (existingVendor) {
      return res.status(409).json({
        success: false,
        message: "Vendor username already exists",
      });
    }

    const vendor = await VendorUser.create({
      name: normalizedName,
      username: normalizedUsername,
      password,
      phone: normalizedPhone,

      role: normalizedRole,

      modules:
        normalizedRole === "superadmin"
          ? ALL_VENDOR_MODULES
          : normalizeVendorModules(modules, true),

      assignedProducts: [],
    });

    return res.status(201).json({
      success: true,

      message:
        normalizedRole === "superadmin"
          ? "Vendor super admin created successfully"
          : "Vendor user created successfully",

      vendor: serializeVendor(vendor),
    });
  } catch (error) {
    console.error("createVendorUser error:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Vendor username already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to create vendor user",
    });
  }
};

/* =========================================================
   VENDOR LOGIN
   POST /api/vendor-users/login
========================================================= */

export const loginVendorUser = async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);

    const password = req.body?.password;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    const vendor = await VendorUser.findOne({
      username,
    }).select("+password");

    if (!vendor) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    if (!vendor.isActive) {
      return res.status(403).json({
        success: false,
        message: "Vendor account is disabled",
      });
    }

    const isMatch = await vendor.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    vendor.lastLoginAt = new Date();

    if (vendor.role === "superadmin") {
      vendor.modules = ALL_VENDOR_MODULES;
    }

    await vendor.save();

    return res.status(200).json({
      success: true,
      message: "Login successful",

      token: generateToken(vendor),

      vendor: serializeVendor(vendor),
    });
  } catch (error) {
    console.error("loginVendorUser error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Vendor login failed",
    });
  }
};

/* =========================================================
   VENDOR PROFILE
   GET /api/vendor-users/profile
========================================================= */

export const getVendorProfile = async (req, res) => {
  try {
    const vendor = await VendorUser.findById(req.vendor._id)
      .select("-password")
      .populate({
        path: "assignedProducts.product",
        select: PRODUCT_SELECT,
      });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    return res.status(200).json({
      success: true,
      vendor: serializeVendor(vendor),
    });
  } catch (error) {
    console.error("getVendorProfile error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch vendor profile",
    });
  }
};

/* =========================================================
   GET ALL VENDOR USERS
   GET /api/vendor-users
========================================================= */

export const getAllVendorUsers = async (req, res) => {
  try {
    const page = toPositiveInt(req.query.page, 1);

    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);

    const skip = (page - 1) * limit;
    const search = normalizeString(req.query.search);

    const query = {};

    if (search) {
      const regex = {
        $regex: escapeRegex(search),
        $options: "i",
      };

      query.$or = [{ name: regex }, { username: regex }, { phone: regex }];
    }

    if (
      req.query.isActive !== undefined &&
      req.query.isActive !== null &&
      String(req.query.isActive).trim() !== ""
    ) {
      query.isActive = normalizeBoolean(req.query.isActive);
    }

    const [vendors, total] = await Promise.all([
      VendorUser.find(query)
        .select("-password")
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean(),

      VendorUser.countDocuments(query),
    ]);

    const mappedVendors = vendors.map(serializeVendor);

    const pages = Math.max(Math.ceil(total / limit), 1);

    return res.status(200).json({
      success: true,
      count: mappedVendors.length,
      total,
      page,
      limit,
      pages,
      hasNextPage: page < pages,
      hasPrevPage: page > 1,
      vendors: mappedVendors,
    });
  } catch (error) {
    console.error("getAllVendorUsers error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch vendors",
    });
  }
};

/* =========================================================
   GET SINGLE VENDOR
   GET /api/vendor-users/:id
========================================================= */

export const getVendorUserById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vendor ID",
      });
    }

    const vendor = await VendorUser.findById(id).select("-password").lean();

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    return res.status(200).json({
      success: true,
      vendor: serializeVendor(vendor),
    });
  } catch (error) {
    console.error("getVendorUserById error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch vendor",
    });
  }
};

/* =========================================================
   UPDATE VENDOR USER
   PUT/PATCH /api/vendor-users/:id
========================================================= */

export const updateVendorUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vendor ID",
      });
    }

    const vendor = await VendorUser.findById(id).select("+password");

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    if (req.body.name !== undefined) {
      const name = normalizeString(req.body.name);

      if (!name) {
        return res.status(400).json({
          success: false,
          message: "Vendor name cannot be empty",
        });
      }

      vendor.name = name;
    }

    if (req.body.phone !== undefined) {
      vendor.phone = normalizeString(req.body.phone);
    }

    if (req.body.username !== undefined) {
      const username = normalizeUsername(req.body.username);

      if (!username) {
        return res.status(400).json({
          success: false,
          message: "Username cannot be empty",
        });
      }

      if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
        return res.status(400).json({
          success: false,
          message:
            "Username can only contain letters, numbers, dot, underscore and hyphen",
        });
      }

      const existingVendor = await VendorUser.findOne({
        _id: {
          $ne: id,
        },
        username,
      }).lean();

      if (existingVendor) {
        return res.status(409).json({
          success: false,
          message: "Vendor username already exists",
        });
      }

      vendor.username = username;
    }

    if (req.body.password !== undefined) {
      const password = String(req.body.password || "");

      if (password) {
        if (password.length < 6) {
          return res.status(400).json({
            success: false,
            message: "Password must contain at least 6 characters",
          });
        }

        vendor.password = password;
      }
    }

    if (req.body.role !== undefined) {
      vendor.role = req.body.role === "superadmin" ? "superadmin" : "vendor";
    }

    if (vendor.role === "superadmin") {
      vendor.modules = ALL_VENDOR_MODULES;

      vendor.assignedProducts = [];
    } else if (req.body.modules !== undefined) {
      vendor.modules = normalizeVendorModules(req.body.modules, false);
    }

    if (req.body.isActive !== undefined) {
      vendor.isActive = normalizeBoolean(req.body.isActive, vendor.isActive);
    }

    await vendor.save();

    return res.status(200).json({
      success: true,
      message: "Vendor updated successfully",
      vendor: serializeVendor(vendor),
    });
  } catch (error) {
    console.error("updateVendorUser error:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Vendor username already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update vendor",
    });
  }
};

/* =========================================================
   DELETE VENDOR USER
   DELETE /api/vendor-users/:id
========================================================= */

export const deleteVendorUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vendor ID",
      });
    }

    const vendor = await VendorUser.findByIdAndDelete(id);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Vendor deleted successfully",
    });
  } catch (error) {
    console.error("deleteVendorUser error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to delete vendor",
    });
  }
};

/* =========================================================
   ASSIGN PRODUCTS TO VENDOR
   POST /api/vendor-users/:vendorId/products/assign

   Body:
   {
     productIds: [],
     productCodes: [],
     modules: ["sampling", "pattern"]
   }
========================================================= */

export const assignProductsToVendor = async (req, res) => {
  try {
    const { vendorId } = req.params;

    if (!isValidObjectId(vendorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vendor ID",
      });
    }

    const vendor = await VendorUser.findById(vendorId);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    if (isSuperAdminVendor(vendor)) {
      return res.status(400).json({
        success: false,
        message: "Super admin already has access to all products",
      });
    }

    const productIds = normalizeIds(req.body.productIds || []);

    const productCodes = normalizeProductCodes(req.body.productCodes || []);

    if (!productIds.length && !productCodes.length) {
      return res.status(400).json({
        success: false,
        message: "At least one product ID or product code is required",
      });
    }

    const invalidIds = productIds.filter(
      (productId) => !isValidObjectId(productId),
    );

    if (invalidIds.length) {
      return res.status(400).json({
        success: false,
        message: "Some product IDs are invalid",
        invalidIds,
      });
    }

    const productFilters = [];

    if (productIds.length) {
      productFilters.push({
        _id: {
          $in: productIds,
        },
      });
    }

    if (productCodes.length) {
      productFilters.push({
        productCode: {
          $in: productCodes,
        },
      });
    }

    const products = await Product.find({
      $or: productFilters,
    })
      .select(PRODUCT_SELECT)
      .lean();

    if (!products.length) {
      return res.status(404).json({
        success: false,
        message: "No matching products found",
      });
    }

    const requestedModules = normalizeAssignmentModules(req.body.modules);

    const inheritedModules = normalizeAssignmentModules(
      vendor.modules?.toObject ? vendor.modules.toObject() : vendor.modules,
    );

    const assignmentModules = hasAtLeastOneModule(requestedModules)
      ? requestedModules
      : inheritedModules;

    if (!hasAtLeastOneModule(assignmentModules)) {
      return res.status(400).json({
        success: false,
        message: "Enable at least one assignment module",
      });
    }

    if (!Array.isArray(vendor.assignedProducts)) {
      vendor.assignedProducts = [];
    }

    const existingAssignmentMap = new Map(
      vendor.assignedProducts.map((assignment, index) => [
        getAssignmentProductId(assignment),
        index,
      ]),
    );

    const now = new Date();

    products.forEach((product) => {
      const productId = String(product._id);

      const existingIndex = existingAssignmentMap.get(productId);

      if (existingIndex !== undefined) {
        vendor.assignedProducts[existingIndex].modules = assignmentModules;

        vendor.assignedProducts[existingIndex].assignedAt = now;

        return;
      }

      vendor.assignedProducts.push({
        product: product._id,

        modules: assignmentModules,

        assignedAt: now,
      });
    });

    vendor.markModified("assignedProducts");

    await vendor.save();

    const populatedVendor = await VendorUser.findById(vendorId)
      .select("assignedProducts")
      .populate({
        path: "assignedProducts.product",
        select: PRODUCT_SELECT,
      })
      .lean();

    const assignedProductIds = new Set(
      products.map((product) => String(product._id)),
    );

    const updatedAssignments = (populatedVendor?.assignedProducts || []).filter(
      (assignment) =>
        assignedProductIds.has(getAssignmentProductId(assignment)),
    );

    const total = populatedVendor?.assignedProducts?.length || 0;

    return res.status(200).json({
      success: true,

      message: `${updatedAssignments.length} product(s) assigned successfully`,

      matchedProducts: products.length,

      total,

      products: updatedAssignments.map(serializeAssignment),

      assignedProducts: updatedAssignments.map(serializeAssignment),
    });
  } catch (error) {
    console.error("assignProductsToVendor error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to assign products",
    });
  }
};

/* =========================================================
   GET VENDOR ASSIGNED PRODUCTS
   GET /api/vendor-users/:vendorId/products

   Query:
   page
   limit
   search
   module
   status
========================================================= */

export const getVendorAssignedProducts = async (req, res) => {
  try {
    const { vendorId } = req.params;

    if (!isValidObjectId(vendorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vendor ID",
      });
    }

    const page = toPositiveInt(req.query.page, 1);

    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);

    const search = normalizeString(req.query.search).toLowerCase();

    const moduleName = normalizeString(req.query.module);

    const status = normalizeString(req.query.status).toLowerCase();

    const vendor = await VendorUser.findById(vendorId)
      .select("role modules assignedProducts")
      .populate({
        path: "assignedProducts.product",
        select: PRODUCT_SELECT,
      })
      .lean();

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    /* =========================================
         SUPER ADMIN: RETURN ALL PRODUCTS
      ========================================= */

    if (isSuperAdminVendor(vendor)) {
      const productQuery = {};

      if (search) {
        const regex = {
          $regex: escapeRegex(search),
          $options: "i",
        };

        productQuery.$or = [
          {
            title: regex,
          },
          {
            productCode: regex,
          },
          {
            slug: regex,
          },
        ];
      }

      switch (status) {
        case "active":
          productQuery.isActive = true;

          productQuery.isDraft = {
            $ne: true,
          };
          break;

        case "inactive":
          productQuery.isActive = false;
          break;

        case "draft":
          productQuery.isDraft = true;
          break;

        case "sampling_done":
          productQuery.isSamplingDone = true;
          break;

        case "sampling_pending":
          productQuery.isSamplingDone = {
            $ne: true,
          };
          break;

        case "pattern_ready":
          productQuery.isPatternReady = true;
          break;

        case "pattern_pending":
          productQuery.isPatternReady = {
            $ne: true,
          };
          break;
      }

      const total = await Product.countDocuments(productQuery);

      const pages = Math.max(Math.ceil(total / limit), 1);

      const safePage = Math.min(page, pages);

      const skip = (safePage - 1) * limit;

      const products = await Product.find(productQuery)
        .select(PRODUCT_SELECT)
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean();

      const responseProducts = products.map((product) => ({
        _id: product._id,

        product,

        modules: {
          ...ALL_VENDOR_MODULES,
        },

        assignedAt: null,

        isSuperAdminAccess: true,
      }));

      return res.status(200).json({
        success: true,

        isSuperAdmin: true,

        hasAllProductAccess: true,

        products: responseProducts,

        assignedProducts: responseProducts,

        total,
        page: safePage,
        limit,
        pages,

        hasNextPage: safePage < pages,

        hasPrevPage: safePage > 1,
      });
    }

    /* =========================================
         NORMAL VENDOR: ASSIGNED PRODUCTS
      ========================================= */

    let assignments = Array.isArray(vendor.assignedProducts)
      ? vendor.assignedProducts
      : [];

    assignments = assignments.filter(
      (assignment) =>
        assignment?.product && typeof assignment.product === "object",
    );

    if (moduleName && VENDOR_MODULES.includes(moduleName)) {
      assignments = assignments.filter(
        (assignment) => assignment.modules?.[moduleName] === true,
      );
    }

    if (search) {
      assignments = assignments.filter((assignment) => {
        const product = assignment.product || {};

        return [product.title, product.productCode, product.slug].some(
          (value) =>
            String(value || "")
              .toLowerCase()
              .includes(search),
        );
      });
    }

    if (status) {
      assignments = assignments.filter((assignment) =>
        productMatchesStatus(assignment.product, status),
      );
    }

    assignments.sort((a, b) => {
      const aDate = new Date(a.assignedAt || 0).getTime();

      const bDate = new Date(b.assignedAt || 0).getTime();

      return bDate - aDate;
    });

    const total = assignments.length;

    const pages = Math.max(Math.ceil(total / limit), 1);

    const safePage = Math.min(page, pages);

    const skip = (safePage - 1) * limit;

    const paginatedAssignments = assignments.slice(skip, skip + limit);

    const responseProducts = paginatedAssignments.map(serializeAssignment);

    return res.status(200).json({
      success: true,

      isSuperAdmin: false,

      hasAllProductAccess: false,

      products: responseProducts,

      assignedProducts: responseProducts,

      total,
      page: safePage,
      limit,
      pages,

      hasNextPage: safePage < pages,

      hasPrevPage: safePage > 1,
    });
  } catch (error) {
    console.error("getVendorAssignedProducts error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch assigned products",
    });
  }
};

/* =========================================================
   REMOVE PRODUCTS FROM VENDOR
   DELETE /api/vendor-users/:vendorId/products

   Body:
   {
     productIds: []
   }
========================================================= */

export const removeProductsFromVendor = async (req, res) => {
  try {
    const { vendorId } = req.params;

    if (!isValidObjectId(vendorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vendor ID",
      });
    }

    const productIds = normalizeIds(req.body.productIds || []);

    if (!productIds.length) {
      return res.status(400).json({
        success: false,
        message: "Select at least one product",
      });
    }

    const invalidIds = productIds.filter(
      (productId) => !isValidObjectId(productId),
    );

    if (invalidIds.length) {
      return res.status(400).json({
        success: false,
        message: "Some product IDs are invalid",
        invalidIds,
      });
    }

    const vendor = await VendorUser.findById(vendorId);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    if (isSuperAdminVendor(vendor)) {
      return res.status(400).json({
        success: false,
        message: "Products cannot be removed from a super admin",
      });
    }

    const removeSet = new Set(productIds.map(String));

    const previousCount = vendor.assignedProducts?.length || 0;

    vendor.assignedProducts = (vendor.assignedProducts || []).filter(
      (assignment) => !removeSet.has(getAssignmentProductId(assignment)),
    );

    const deletedCount = previousCount - vendor.assignedProducts.length;

    vendor.markModified("assignedProducts");

    await vendor.save();

    return res.status(200).json({
      success: true,

      message: `${deletedCount} product(s) removed successfully`,

      deletedCount,

      total: vendor.assignedProducts.length,
    });
  } catch (error) {
    console.error("removeProductsFromVendor error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to remove assigned products",
    });
  }
};

/* =========================================================
   UPDATE MODULES FOR ONE ASSIGNED PRODUCT
   PATCH /api/vendor-users/:vendorId/products/:productId

   Body:
   {
     modules: {
       sampling: true,
       pattern: false,
       production: true,
       cuttingList: false
     }
   }
========================================================= */

export const updateAssignedProductModules = async (req, res) => {
  try {
    const { vendorId, productId } = req.params;

    if (!isValidObjectId(vendorId) || !isValidObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vendor or product ID",
      });
    }

    const modules = normalizeAssignmentModules(req.body.modules);

    if (!hasAtLeastOneModule(modules)) {
      return res.status(400).json({
        success: false,
        message: "Enable at least one module",
      });
    }

    const vendor = await VendorUser.findById(vendorId);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    if (isSuperAdminVendor(vendor)) {
      return res.status(400).json({
        success: false,
        message: "Super admin already has all product permissions",
      });
    }

    const assignment = vendor.assignedProducts?.find(
      (item) => getAssignmentProductId(item) === String(productId),
    );

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Product assignment not found",
      });
    }

    assignment.modules = modules;

    vendor.markModified("assignedProducts");

    await vendor.save();

    const populatedVendor = await VendorUser.findById(vendorId)
      .select("assignedProducts")
      .populate({
        path: "assignedProducts.product",
        select: PRODUCT_SELECT,
      })
      .lean();

    const updatedAssignment = populatedVendor?.assignedProducts?.find(
      (item) => getAssignmentProductId(item) === String(productId),
    );

    if (!updatedAssignment) {
      return res.status(404).json({
        success: false,
        message: "Updated assignment not found",
      });
    }

    const responseAssignment = serializeAssignment(updatedAssignment);

    return res.status(200).json({
      success: true,

      message: "Product permissions updated successfully",

      assignment: responseAssignment,

      product: responseAssignment,
    });
  } catch (error) {
    console.error("updateAssignedProductModules error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update product permissions",
    });
  }
};
