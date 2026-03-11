import mongoose from "mongoose";
import Product from "./Products.js";
import { reconcileBackordersForVariant } from "../inventoryUtility/reconcileBackordersForVariant.js";

/* ============================================================
   SMALL HELPERS
============================================================ */
const arr = (v) =>
  !v
    ? []
    : Array.isArray(v)
      ? v
      : typeof v === "string"
        ? v
            .split(",")
            .map((x) => String(x || "").trim())
            .filter(Boolean)
        : [];

const s = (v) => String(v ?? "").trim();

const toBool = (v) => {
  if (typeof v === "boolean") return v;
  const x = String(v ?? "").trim().toLowerCase();
  return x === "true" || x === "1" || x === "yes";
};

const toNonNegInt = (v, fallback = 0) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isMongoId = (v) =>
  mongoose.Types.ObjectId.isValid(String(v || "").trim());

const normalizeSize = (v) =>
  String(v || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

const getVariantSize = (variant) => {
  if (!variant) return "";
  if (variant.size) return String(variant.size);

  const attrs = Array.isArray(variant.attributes) ? variant.attributes : [];
  const hit = attrs.find((a) => {
    const key = String(a?.key || "").trim().toLowerCase();
    return key === "size" || key === "sizes" || key === "shirt_size";
  });

  return hit?.value ? String(hit.value) : "";
};

const uniqStrings = (list = []) => {
  const seen = new Set();
  const out = [];

  for (const item of list) {
    const val = s(item);
    if (!val) continue;
    if (seen.has(val)) continue;
    seen.add(val);
    out.push(val);
  }

  return out;
};

const parseCommaList = (v) =>
  arr(v)
    .map((x) => s(x))
    .filter(Boolean);

const parseNumericRange = ({ min, max }) => {
  const out = {};
  if (min !== undefined && min !== null && s(min) !== "") {
    const n = Number(min);
    if (Number.isFinite(n)) out.$gte = n;
  }
  if (max !== undefined && max !== null && s(max) !== "") {
    const n = Number(max);
    if (Number.isFinite(n)) out.$lte = n;
  }
  return Object.keys(out).length ? out : null;
};

/* ============================================================
   INVENTORY VIEW STOCK NORMALIZER
============================================================ */
const applyInventoryStockFromVariants = (doc) => {
  const p = doc?.toObject ? doc.toObject() : doc;
  if (!p) return p;

  const variants = Array.isArray(p.variants) ? p.variants : [];
  const isVariable = p.productType === "variable" || variants.length > 0;

  if (!isVariable) {
    const stock = Number(p.stock ?? 0);
    const reservedStock = Number(p.reservedStock ?? 0);
    const availableStock = Math.max(0, stock - reservedStock);

    return {
      ...p,
      stock,
      reservedStock,
      availableStock,
      isInStock: availableStock > 0,
    };
  }

  const normalizedVariants = variants.map((v) => {
    const stock = Number(v?.stock ?? 0);
    const reservedStock = Number(v?.reservedStock ?? 0);
    const availableStock = Math.max(0, stock - reservedStock);

    return {
      ...v,
      stock,
      reservedStock,
      availableStock,
      isInStock: availableStock > 0,
      size: v?.size || getVariantSize(v) || "",
    };
  });

  const stock = normalizedVariants.reduce(
    (sum, v) => sum + Number(v.stock || 0),
    0
  );
  const reservedStock = normalizedVariants.reduce(
    (sum, v) => sum + Number(v.reservedStock || 0),
    0
  );
  const availableStock = Math.max(0, stock - reservedStock);
  const isInStock = normalizedVariants.some(
    (v) => Number(v.availableStock || 0) > 0
  );

  return {
    ...p,
    variants: normalizedVariants,
    stock,
    reservedStock,
    availableStock,
    isInStock,
  };
};

/* ============================================================
   SEARCH FILTER
============================================================ */
const buildInventorySearchFilter = (query) => {
  const q = s(query);
  if (!q) return null;

  const rx = new RegExp(escapeRegex(q), "i");
  const normalizedQSize = normalizeSize(q);

  return {
    $or: [
      { productCode: rx },
      { title: rx },
      { sku: rx },
      { "variants.sku": rx },
      { "variants.barcode": rx },
      { "variants.size": rx },
      {
        variants: {
          $elemMatch: {
            attributes: {
              $elemMatch: {
                key: { $in: ["size", "sizes", "shirt_size"] },
                value: rx,
              },
            },
          },
        },
      },
      {
        variants: {
          $elemMatch: {
            size: normalizedQSize,
          },
        },
      },
    ],
  };
};

/* ============================================================
   CATEGORY / FOOTWEAR FILTERS
============================================================ */
const buildInventoryCategoryFilters = ({
  category,
  categories,
  hideFootwear,
  footwearKeys,
}) => {
  const and = [];

  const catList = uniqStrings([
    ...parseCommaList(category),
    ...parseCommaList(categories),
  ]);

  if (catList.length) {
    and.push({
      $or: catList.map((cat) => ({
        categories: {
          $elemMatch: {
            $regex: new RegExp(escapeRegex(cat), "i"),
          },
        },
      })),
    });
  }

  if (hideFootwear) {
    const keys = uniqStrings(footwearKeys).map((x) => x.toLowerCase());
    if (keys.length) {
      const footwearRegex = new RegExp(keys.map(escapeRegex).join("|"), "i");

      and.push({
        $nor: [
          {
            categories: {
              $elemMatch: {
                $regex: footwearRegex,
              },
            },
          },
        ],
      });
    }
  }

  return and;
};

/* ============================================================
   EXTRA FILTERS FOR GET ALL
============================================================ */
const buildInventoryExtraFilters = (reqQuery = {}) => {
  const and = [];

  const {
    productType,
    hasVariants,
    inStock,
    isActive,
    isDraft,
    isBestSeller,
    category,
    categories,
    minStock,
    maxStock,
    minAvailableStock,
    maxAvailableStock,
    minReservedStock,
    maxReservedStock,
  } = reqQuery;

  if (s(productType)) {
    and.push({ productType: s(productType).toLowerCase() });
  }

  if (hasVariants !== undefined && s(hasVariants) !== "") {
    const wantsVariants = toBool(hasVariants);
    and.push(
      wantsVariants
        ? { "variants.0": { $exists: true } }
        : { $or: [{ variants: { $exists: false } }, { variants: { $size: 0 } }] }
    );
  }

  if (isActive !== undefined && s(isActive) !== "") {
    and.push({ isActive: toBool(isActive) });
  }

  if (isDraft !== undefined && s(isDraft) !== "") {
    and.push({ isDraft: toBool(isDraft) });
  }

  if (isBestSeller !== undefined && s(isBestSeller) !== "") {
    and.push({ isBestSeller: toBool(isBestSeller) });
  }

  const categoryFilters = buildInventoryCategoryFilters({
    category,
    categories,
    hideFootwear: false,
    footwearKeys: [],
  });
  if (categoryFilters.length) and.push(...categoryFilters);

  const stockRange = parseNumericRange({ min: minStock, max: maxStock });
  if (stockRange) and.push({ stock: stockRange });

  const reservedRange = parseNumericRange({
    min: minReservedStock,
    max: maxReservedStock,
  });
  if (reservedRange) and.push({ reservedStock: reservedRange });

  if (inStock !== undefined && s(inStock) !== "") {
    const wantsInStock = toBool(inStock);

    if (wantsInStock) {
      and.push({
        $or: [
          {
            $expr: {
              $gt: [
                {
                  $max: [
                    0,
                    {
                      $subtract: [
                        { $ifNull: ["$stock", 0] },
                        { $ifNull: ["$reservedStock", 0] },
                      ],
                    },
                  ],
                },
                0,
              ],
            },
          },
          {
            variants: {
              $elemMatch: {
                $expr: {
                  $gt: [
                    {
                      $max: [
                        0,
                        {
                          $subtract: [
                            { $ifNull: ["$stock", 0] },
                            { $ifNull: ["$reservedStock", 0] },
                          ],
                        },
                      ],
                    },
                    0,
                  ],
                },
              },
            },
          },
        ],
      });
    } else {
      and.push({
        $and: [
          {
            $expr: {
              $lte: [
                {
                  $max: [
                    0,
                    {
                      $subtract: [
                        { $ifNull: ["$stock", 0] },
                        { $ifNull: ["$reservedStock", 0] },
                      ],
                    },
                  ],
                },
                0,
              ],
            },
          },
          {
            $nor: [
              {
                variants: {
                  $elemMatch: {
                    $expr: {
                      $gt: [
                        {
                          $max: [
                            0,
                            {
                              $subtract: [
                                { $ifNull: ["$stock", 0] },
                                { $ifNull: ["$reservedStock", 0] },
                              ],
                            },
                          ],
                        },
                        0,
                      ],
                    },
                  },
                },
              },
            ],
          },
        ],
      });
    }
  }

  const minAvail = s(minAvailableStock);
  const maxAvail = s(maxAvailableStock);
  if (minAvail !== "" || maxAvail !== "") {
    const minA = minAvail === "" ? null : Number(minAvail);
    const maxA = maxAvail === "" ? null : Number(maxAvail);

    const expr = {
      $max: [
        0,
        {
          $subtract: [
            { $ifNull: ["$stock", 0] },
            { $ifNull: ["$reservedStock", 0] },
          ],
        },
      ],
    };

    const exprConditions = [];
    if (Number.isFinite(minA)) exprConditions.push({ $gte: [expr, minA] });
    if (Number.isFinite(maxA)) exprConditions.push({ $lte: [expr, maxA] });

    if (exprConditions.length === 1) {
      and.push({ $expr: exprConditions[0] });
    } else if (exprConditions.length > 1) {
      and.push({ $expr: { $and: exprConditions } });
    }
  }

  return and;
};

/* ============================================================
   SORT
============================================================ */
const getInventorySortObject = (sort = "") => {
  const key = s(sort).toLowerCase();

  switch (key) {
    case "oldest":
      return { createdAt: 1, _id: 1 };
    case "title_asc":
      return { title: 1, _id: -1 };
    case "title_desc":
      return { title: -1, _id: -1 };
    case "code_asc":
      return { productCode: 1, _id: -1 };
    case "code_desc":
      return { productCode: -1, _id: -1 };
    case "stock_asc":
      return { stock: 1, updatedAt: -1, _id: -1 };
    case "stock_desc":
      return { stock: -1, updatedAt: -1, _id: -1 };
    case "updated_asc":
      return { updatedAt: 1, _id: 1 };
    case "updated_desc":
    case "latest":
    case "newest":
    default:
      return { updatedAt: -1, createdAt: -1, _id: -1 };
  }
};

/* ============================================================
   PROJECTION
============================================================ */
const getInventoryProjection = () => ({
  _id: 1,
  title: 1,
  productCode: 1,
  sku: 1,
  stock: 1,
  reservedStock: 1,
  isInStock: 1,
  isActive: 1,
  isDraft: 1,
  isBestSeller: 1,
  productType: 1,
  thumbnail: 1,
  images: 1,
  categories: 1,
  updatedAt: 1,
  createdAt: 1,
  variants: 1,
});

/* ============================================================
   ✅ GET INVENTORY ADMIN PRODUCTS
   GET /api/products/admin/inventory
============================================================ */
export const getInventoryAdminProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 70,
      q = "",
      category = "",
      categories = "",
      hideFootwear = "true",
      footwearKeys = "footwear,shoes,sneakers,slippers,sandals",
      sort = "updated_desc",
      productType,
      hasVariants,
      inStock,
      isActive,
      isDraft,
      isBestSeller,
      minStock,
      maxStock,
      minAvailableStock,
      maxAvailableStock,
      minReservedStock,
      maxReservedStock,
    } = req.query;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 70));
    const skip = (safePage - 1) * safeLimit;

    const shouldHideFootwear = String(hideFootwear).trim().toLowerCase() === "true";

    const footwearList = arr(footwearKeys)
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean);

    const andFilters = [];

    const searchFilter = buildInventorySearchFilter(q);
    if (searchFilter) andFilters.push(searchFilter);

    const categoryFilters = buildInventoryCategoryFilters({
      category,
      categories,
      hideFootwear: shouldHideFootwear,
      footwearKeys: footwearList,
    });
    if (categoryFilters.length) andFilters.push(...categoryFilters);

    const extraFilters = buildInventoryExtraFilters({
      productType,
      hasVariants,
      inStock,
      isActive,
      isDraft,
      isBestSeller,
      category: "",
      categories: "",
      minStock,
      maxStock,
      minAvailableStock,
      maxAvailableStock,
      minReservedStock,
      maxReservedStock,
    });
    if (extraFilters.length) andFilters.push(...extraFilters);

    const filters = andFilters.length ? { $and: andFilters } : {};

    const docs = await Product.find(filters, getInventoryProjection())
      .sort(getInventorySortObject(sort))
      .skip(skip)
      .limit(safeLimit)
      .lean();

    const total = await Product.countDocuments(filters);

    const products = (docs || []).map(applyInventoryStockFromVariants);

    return res.json({
      success: true,
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit),
      filtersApplied: {
        q: s(q),
        category: s(category),
        categories: parseCommaList(categories),
        hideFootwear: shouldHideFootwear,
        productType: s(productType),
        hasVariants:
          hasVariants !== undefined && s(hasVariants) !== "" ? toBool(hasVariants) : undefined,
        inStock:
          inStock !== undefined && s(inStock) !== "" ? toBool(inStock) : undefined,
        isActive:
          isActive !== undefined && s(isActive) !== "" ? toBool(isActive) : undefined,
        isDraft:
          isDraft !== undefined && s(isDraft) !== "" ? toBool(isDraft) : undefined,
        isBestSeller:
          isBestSeller !== undefined && s(isBestSeller) !== ""
            ? toBool(isBestSeller)
            : undefined,
        minStock: s(minStock),
        maxStock: s(maxStock),
        minAvailableStock: s(minAvailableStock),
        maxAvailableStock: s(maxAvailableStock),
        minReservedStock: s(minReservedStock),
        maxReservedStock: s(maxReservedStock),
        sort: s(sort) || "updated_desc",
      },
      products,
    });
  } catch (e) {
    console.error("❌ getInventoryAdminProducts Error:", e);
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to fetch inventory products",
    });
  }
};

/* ============================================================
   ✅ GET INVENTORY ADMIN CATEGORIES
   GET /api/products/admin/inventory/categories
============================================================ */
export const getInventoryAdminCategories = async (_req, res) => {
  try {
    const rows = await Product.distinct("categories");

    const categories = uniqStrings(rows)
      .filter((x) => !isMongoId(x))
      .sort((a, b) => a.localeCompare(b));

    return res.json({
      success: true,
      categories,
    });
  } catch (e) {
    console.error("❌ getInventoryAdminCategories Error:", e);
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to fetch inventory categories",
    });
  }
};

/* ============================================================
   ✅ GET SINGLE INVENTORY PRODUCT
   GET /api/products/admin/inventory/:id
   Supports:
   - Mongo _id
   - productCode
============================================================ */
export const getSingleInventoryAdminProduct = async (req, res) => {
  try {
    const rawId = s(req.params.id);
    if (!rawId) {
      return res.status(400).json({
        success: false,
        message: "Product id is required",
      });
    }

    const findQuery = isMongoId(rawId)
      ? { _id: rawId }
      : { productCode: rawId };

    const doc = await Product.findOne(findQuery, getInventoryProjection()).lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    return res.json({
      success: true,
      product: applyInventoryStockFromVariants(doc),
    });
  } catch (e) {
    console.error("❌ getSingleInventoryAdminProduct Error:", e);
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to fetch product inventory",
    });
  }
};

/* ============================================================
   ✅ UPDATE SINGLE INVENTORY PRODUCT
   PATCH /api/products/admin/inventory/:id
   Body:
   {
     stock: 10
   }
   OR
   {
     size: "M",
     stock: 10
   }
   OR
   {
     variantId: "...",
     stock: 10
   }
============================================================ */
export const updateSingleInventoryAdminProduct = async (req, res) => {
  try {
    const rawId = s(req.params.id);
    if (!rawId) {
      return res.status(400).json({
        success: false,
        message: "Product id is required",
      });
    }

    const nextStock = toNonNegInt(req.body?.stock, -1);
    if (nextStock < 0) {
      return res.status(400).json({
        success: false,
        message: "stock must be a non-negative integer",
      });
    }

    const findQuery = isMongoId(rawId)
      ? { _id: rawId }
      : { productCode: rawId };

    const product = await Product.findOne(findQuery);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const variants = Array.isArray(product.variants) ? product.variants : [];
    const isVariable = product.productType === "variable" || variants.length > 0;

    const reqSize = normalizeSize(req.body?.size);
    const reqVariantId = s(req.body?.variantId);

    if (!isVariable) {
      if (reqSize || reqVariantId) {
        return res.status(400).json({
          success: false,
          message:
            "This is a simple product. Do not send size/variantId for simple products.",
        });
      }

      product.stock = nextStock;
      product.markModified("stock");
      await product.save({ validateBeforeSave: true });

      const updated = await Product.findById(product._id, getInventoryProjection()).lean();

      return res.json({
        success: true,
        message: "Simple product inventory updated successfully",
        mode: "simple",
        updated: {
          productId: String(product._id),
          stock: nextStock,
        },
        product: applyInventoryStockFromVariants(updated),
      });
    }

    let targetVariant = null;

    if (reqVariantId) {
      targetVariant =
        variants.find((v) => String(v?._id || "") === reqVariantId) || null;
    }

    if (!targetVariant && reqSize) {
      targetVariant =
        variants.find((v) => normalizeSize(getVariantSize(v)) === reqSize) || null;
    }

    if (!targetVariant) {
      return res.status(400).json({
        success: false,
        message:
          "Variable product detected. Send size or variantId to update a specific variant.",
      });
    }

    targetVariant.stock = nextStock;
    product.markModified("variants");

    const totalStock = variants.reduce(
      (sum, v) => sum + Number(v?.stock ?? 0),
      0
    );
    product.stock = totalStock;
    product.markModified("stock");

    await product.save({ validateBeforeSave: true });

    let reconcileSummary = null;
    try {
      reconcileSummary = await reconcileBackordersForVariant({
        productId: product._id,
        variantId: targetVariant._id,
      });
    } catch (reErr) {
      console.error(
        "⚠️ reconcileBackordersForVariant failed:",
        reErr?.message || reErr
      );
    }

    const updated = await Product.findById(product._id, getInventoryProjection()).lean();

    return res.json({
      success: true,
      message: "Variant inventory updated successfully",
      mode: "variant",
      updated: {
        productId: String(product._id),
        variantId: String(targetVariant._id),
        size: getVariantSize(targetVariant) || targetVariant.size || "",
        stock: nextStock,
      },
      reconcile: reconcileSummary,
      product: applyInventoryStockFromVariants(updated),
    });
  } catch (e) {
    console.error("❌ updateSingleInventoryAdminProduct Error:", e);
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to update inventory",
    });
  }
};