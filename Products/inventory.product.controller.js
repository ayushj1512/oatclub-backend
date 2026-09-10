import mongoose from "mongoose";
import Product from "./Products.js";
import { reconcilePendingReservationsInternal } from "../InventoryReservation/InventoryReservationController.js";

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

const INVENTORY_SOURCES = new Set([
  "manual",
  "production",
  "rto",
  "return",
  "order",
  "correction",
  "bulk_update",
  "other",
]);

const getInventorySource = (value) => {
  const source = s(value).toLowerCase();
  return INVENTORY_SOURCES.has(source) ? source : "manual";
};

const getInventoryUpdatedBy = (req) => {
  const id =
    req.user?._id ||
    req.adminUser?._id ||
    req.admin?._id ||
    null;

  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? id
    : null;
};

const createInventoryHistoryEntry = ({
  req,
  scope,
  variantId = null,
  size = "",
  sku = "",
  stockBefore,
  stockAfter,
}) => {
  const difference = Number(stockAfter) - Number(stockBefore);

  // Same stock dobara save hua toh log nahi banega
  if (difference === 0) return null;

  return {
    type: difference > 0 ? "IN" : "OUT",
    scope,
    variantId,
    size,
    sku,
    stockBefore: Number(stockBefore),
    quantityChanged: Math.abs(difference),
    stockAfter: Number(stockAfter),
    source: getInventorySource(req.body?.source),
    referenceId: s(req.body?.referenceId),
    note: s(req.body?.note),
    updatedBy: getInventoryUpdatedBy(req),
    createdAt: new Date(),
  };
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
  const p = doc?.toObject
    ? doc.toObject()
    : doc;

  if (!p) return p;

  const stockType =
    p.stockType === "limited"
      ? "limited"
      : "unlimited";

  const variants = Array.isArray(p.variants)
    ? p.variants
    : [];

  const isVariable =
    p.productType === "variable" ||
    variants.length > 0;

  if (!isVariable) {
    const stock = Number(p.stock ?? 0);
    const reservedStock = Number(
      p.reservedStock ?? 0,
    );

    const availableStock = Math.max(
      0,
      stock - reservedStock,
    );

    return {
      ...p,
      stockType,
      stock,
      reservedStock,
      availableStock,
      isInStock:
        stockType === "unlimited" ||
        availableStock > 0,
    };
  }

  const normalizedVariants = variants.map(
    (variant) => {
      const stock = Number(
        variant?.stock ?? 0,
      );

      const reservedStock = Number(
        variant?.reservedStock ?? 0,
      );

      const availableStock = Math.max(
        0,
        stock - reservedStock,
      );

      return {
        ...variant,
        stock,
        reservedStock,
        availableStock,
        isInStock:
          stockType === "unlimited" ||
          availableStock > 0,
        size:
          variant?.size ||
          getVariantSize(variant) ||
          "",
      };
    },
  );

  const stock = normalizedVariants.reduce(
    (sum, variant) =>
      sum + variant.stock,
    0,
  );

  const reservedStock =
    normalizedVariants.reduce(
      (sum, variant) =>
        sum + variant.reservedStock,
      0,
    );

  return {
    ...p,
    stockType,
    variants: normalizedVariants,
    stock,
    reservedStock,
    availableStock: Math.max(
      0,
      stock - reservedStock,
    ),
    isInStock:
      stockType === "unlimited" ||
      normalizedVariants.some(
        (variant) => variant.isInStock,
      ),
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
  stockType: 1,
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
/* ============================================================
   GET INVENTORY ADMIN PRODUCTS
   GET /api/products/admin/inventory
============================================================ */

export const getInventoryAdminProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 70,

      q = "",
      search = "",
      size = "",

      category = "",
      categories = "",

      hideFootwear = "true",
      footwearKeys = "footwear,shoes,sneakers,slippers,sandals",

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

      sort = "updated_desc",
      sortKey,
      sortDir,
    } = req.query;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 70));
    const skip = (safePage - 1) * safeLimit;

    const searchText = s(search || q);
    const selectedSize = normalizeSize(size);

    const shouldHideFootwear = [
      "true",
      "1",
      "yes",
    ].includes(String(hideFootwear).trim().toLowerCase());

    const footwearList = arr(footwearKeys)
      .map((item) => s(item).toLowerCase())
      .filter(Boolean);

    const matchFilters = [];

    /* ---------------------------------------------------------
       SEARCH
    --------------------------------------------------------- */

    if (searchText) {
      const rx = new RegExp(escapeRegex(searchText), "i");

      matchFilters.push({
        $or: [
          { productCode: rx },
          { title: rx },
          { slug: rx },
          { sku: rx },
          { categories: rx },
          { "variants.sku": rx },
          { "variants.barcode": rx },
          { "variants.size": rx },
          { "variants.attributes.value": rx },
        ],
      });
    }

    /* ---------------------------------------------------------
       CATEGORY
    --------------------------------------------------------- */

    const categoryList = uniqStrings([
      ...parseCommaList(category),
      ...parseCommaList(categories),
    ]);

    if (categoryList.length) {
      matchFilters.push({
        $or: categoryList.map((item) => ({
          categories: {
            $elemMatch: {
              $regex: new RegExp(escapeRegex(item), "i"),
            },
          },
        })),
      });
    }

    /* ---------------------------------------------------------
       HIDE FOOTWEAR
    --------------------------------------------------------- */

    if (shouldHideFootwear && footwearList.length) {
      const footwearRegex = new RegExp(
        footwearList.map(escapeRegex).join("|"),
        "i",
      );

      matchFilters.push({
        categories: {
          $not: {
            $elemMatch: {
              $regex: footwearRegex,
            },
          },
        },
      });
    }

    /* ---------------------------------------------------------
       PRODUCT FLAGS
    --------------------------------------------------------- */

    if (s(productType)) {
      matchFilters.push({
        productType: s(productType).toLowerCase(),
      });
    }

    if (hasVariants !== undefined && s(hasVariants) !== "") {
      matchFilters.push(
        toBool(hasVariants)
          ? { "variants.0": { $exists: true } }
          : {
            $or: [
              { variants: { $exists: false } },
              { variants: { $size: 0 } },
            ],
          },
      );
    }

    if (isActive !== undefined && s(isActive) !== "") {
      matchFilters.push({
        isActive: toBool(isActive),
      });
    }

    if (isDraft !== undefined && s(isDraft) !== "") {
      matchFilters.push({
        isDraft: toBool(isDraft),
      });
    }

    if (isBestSeller !== undefined && s(isBestSeller) !== "") {
      matchFilters.push({
        isBestSeller: toBool(isBestSeller),
      });
    }

    const initialMatch = matchFilters.length
      ? {
        $and: matchFilters,
      }
      : {};

    /* ---------------------------------------------------------
       INVENTORY RANGE HELPERS
    --------------------------------------------------------- */

    const totalRange = parseNumericRange({
      min: minStock,
      max: maxStock,
    });

    const reservedRange = parseNumericRange({
      min: minReservedStock,
      max: maxReservedStock,
    });

    const availableRange = parseNumericRange({
      min: minAvailableStock,
      max: maxAvailableStock,
    });

    const inventoryMatch = {};

    if (totalRange) {
      inventoryMatch.totalInventory = totalRange;
    }

    if (reservedRange) {
      inventoryMatch.reservedInventory = reservedRange;
    }

    if (availableRange) {
      inventoryMatch.availableInventory = availableRange;
    }

    if (inStock !== undefined && s(inStock) !== "") {
      inventoryMatch.availableInventory = {
        ...(inventoryMatch.availableInventory || {}),
        ...(toBool(inStock) ? { $gt: 0 } : { $lte: 0 }),
      };
    }

    /* ---------------------------------------------------------
       SORT
    --------------------------------------------------------- */

    const sortMap = {
      newest: {
        createdAt: -1,
        _id: -1,
      },

      oldest: {
        createdAt: 1,
        _id: 1,
      },

      updated_desc: {
        updatedAt: -1,
        _id: -1,
      },

      updated_asc: {
        updatedAt: 1,
        _id: 1,
      },

      title_asc: {
        title: 1,
        _id: -1,
      },

      title_desc: {
        title: -1,
        _id: -1,
      },

      code_asc: {
        productCode: 1,
        _id: -1,
      },

      code_desc: {
        productCode: -1,
        _id: -1,
      },

      stock_asc: {
        totalInventory: 1,
        updatedAt: -1,
      },

      stock_desc: {
        totalInventory: -1,
        updatedAt: -1,
      },

      reserved_asc: {
        reservedInventory: 1,
        updatedAt: -1,
      },

      reserved_desc: {
        reservedInventory: -1,
        updatedAt: -1,
      },

      available_asc: {
        availableInventory: 1,
        updatedAt: -1,
      },

      available_desc: {
        availableInventory: -1,
        updatedAt: -1,
      },
    };

    let sortObject = sortMap[s(sort).toLowerCase()] || sortMap.updated_desc;

    const customSortFields = {
      title: "title",
      productCode: "productCode",
      stock: "totalInventory",
      totalInventory: "totalInventory",
      reservedStock: "reservedInventory",
      reservedInventory: "reservedInventory",
      availableStock: "availableInventory",
      availableInventory: "availableInventory",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    };

    if (s(sortKey) && customSortFields[s(sortKey)]) {
      sortObject = {
        [customSortFields[s(sortKey)]]:
          s(sortDir).toLowerCase() === "asc" ? 1 : -1,
        _id: -1,
      };
    }

    /* ---------------------------------------------------------
       AGGREGATION
    --------------------------------------------------------- */

    const pipeline = [
      {
        $match: initialMatch,
      },
      {
        $addFields: {
          stockType: {
            $cond: [
              { $eq: ["$stockType", "limited"] },
              "limited",
              "unlimited",
            ],
          },
        },
      },
      {
        $addFields: {
          inventoryVariants: {
            $map: {
              input: {
                $ifNull: ["$variants", []],
              },
              as: "variant",
              in: {
                _id: "$$variant._id",
                sku: "$$variant.sku",
                barcode: "$$variant.barcode",

                attributes: {
                  $ifNull: ["$$variant.attributes", []],
                },

                size: {
                  $ifNull: [
                    "$$variant.size",
                    {
                      $let: {
                        vars: {
                          sizeAttribute: {
                            $arrayElemAt: [
                              {
                                $filter: {
                                  input: {
                                    $ifNull: [
                                      "$$variant.attributes",
                                      [],
                                    ],
                                  },
                                  as: "attribute",
                                  cond: {
                                    $in: [
                                      {
                                        $toLower: {
                                          $ifNull: [
                                            "$$attribute.key",
                                            "",
                                          ],
                                        },
                                      },
                                      [
                                        "size",
                                        "sizes",
                                        "shirt_size",
                                      ],
                                    ],
                                  },
                                },
                              },
                              0,
                            ],
                          },
                        },
                        in: {
                          $ifNull: [
                            "$$sizeAttribute.value",
                            "",
                          ],
                        },
                      },
                    },
                  ],
                },

                stock: {
                  $convert: {
                    input: {
                      $ifNull: ["$$variant.stock", 0],
                    },
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },

                reservedStock: {
                  $convert: {
                    input: {
                      $ifNull: [
                        "$$variant.reservedStock",
                        0,
                      ],
                    },
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
              },
            },
          },

          hasInventoryVariants: {
            $gt: [
              {
                $size: {
                  $ifNull: ["$variants", []],
                },
              },
              0,
            ],
          },
        },
      },

      {
        $addFields: {
          inventoryVariants: {
            $map: {
              input: "$inventoryVariants",
              as: "variant",
              in: {
                $mergeObjects: [
                  "$$variant",
                  {
                    availableStock: {
                      $max: [
                        0,
                        {
                          $subtract: [
                            "$$variant.stock",
                            "$$variant.reservedStock",
                          ],
                        },
                      ],
                    },

                    isInStock: {
                      $or: [
                        {
                          $eq: [
                            "$stockType",
                            "unlimited",
                          ],
                        },
                        {
                          $gt: [
                            {
                              $max: [
                                0,
                                {
                                  $subtract: [
                                    "$$variant.stock",
                                    "$$variant.reservedStock",
                                  ],
                                },
                              ],
                            },
                            0,
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },

      ...(selectedSize
        ? [
          {
            $match: {
              inventoryVariants: {
                $elemMatch: {
                  size: selectedSize,
                  availableStock: { $gt: 0 },
                },
              },
            },
          },
        ]
        : []),

      {
        $addFields: {
          totalInventory: {
            $cond: [
              "$hasInventoryVariants",
              {
                $sum: "$inventoryVariants.stock",
              },
              {
                $convert: {
                  input: {
                    $ifNull: ["$stock", 0],
                  },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            ],
          },

          reservedInventory: {
            $cond: [
              "$hasInventoryVariants",
              {
                $sum: "$inventoryVariants.reservedStock",
              },
              {
                $convert: {
                  input: {
                    $ifNull: ["$reservedStock", 0],
                  },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            ],
          },
        },
      },

      {
        $addFields: {
          availableInventory: {
            $max: [
              0,
              {
                $subtract: [
                  "$totalInventory",
                  "$reservedInventory",
                ],
              },
            ],
          },
        },
      },

      ...(Object.keys(inventoryMatch).length
        ? [
          {
            $match: inventoryMatch,
          },
        ]
        : []),

      {
        $facet: {
          products: [
            {
              $sort: sortObject,
            },
            {
              $skip: skip,
            },
            {
              $limit: safeLimit,
            },
            {
              $project: {
                _id: 1,

                title: 1,
                name: "$title",

                productCode: 1,
                sku: 1,
                productType: 1,
                stockType: 1,

                thumbnail: {
                  $ifNull: [
                    "$thumbnail",
                    {
                      $arrayElemAt: [
                        {
                          $ifNull: ["$images", []],
                        },
                        0,
                      ],
                    },
                  ],
                },

                image: {
                  $ifNull: [
                    "$thumbnail",
                    {
                      $arrayElemAt: [
                        {
                          $ifNull: ["$images", []],
                        },
                        0,
                      ],
                    },
                  ],
                },

                images: {
                  $ifNull: ["$images", []],
                },

                categories: {
                  $ifNull: ["$categories", []],
                },

                totalInventory: 1,
                reservedInventory: 1,
                availableInventory: 1,

                stock: "$totalInventory",
                reservedStock: "$reservedInventory",
                availableStock: "$availableInventory",

                isInStock: {
                  $or: [
                    { $eq: ["$stockType", "unlimited"] },
                    { $gt: ["$availableInventory", 0] },
                  ],
                },

                isActive: 1,
                isDraft: 1,
                isBestSeller: 1,

                variants: "$inventoryVariants",

                createdAt: 1,
                updatedAt: 1,
              },
            },
          ],

          metadata: [
            {
              $count: "total",
            },
          ],

          summary: [
            {
              $group: {
                _id: null,

                totalInventory: {
                  $sum: "$totalInventory",
                },

                reservedInventory: {
                  $sum: "$reservedInventory",
                },

                availableInventory: {
                  $sum: "$availableInventory",
                },

                inStockProducts: {
                  $sum: {
                    $cond: [
                      {
                        $gt: [
                          "$availableInventory",
                          0,
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },

                outOfStockProducts: {
                  $sum: {
                    $cond: [
                      {
                        $lte: [
                          "$availableInventory",
                          0,
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    ];

    const [result] = await Product.aggregate(pipeline);

    const products = result?.products || [];
    const total = result?.metadata?.[0]?.total || 0;

    const rawSummary = result?.summary?.[0] || {};

    return res.status(200).json({
      success: true,

      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit),
      hasNextPage: safePage * safeLimit < total,
      hasPreviousPage: safePage > 1,

      summary: {
        totalProducts: total,
        totalInventory: Number(rawSummary.totalInventory || 0),
        reservedInventory: Number(rawSummary.reservedInventory || 0),
        availableInventory: Number(rawSummary.availableInventory || 0),
        inStockProducts: Number(rawSummary.inStockProducts || 0),
        outOfStockProducts: Number(
          rawSummary.outOfStockProducts || 0,
        ),
      },

      filtersApplied: {
        search: searchText,
        size: selectedSize,
        category: s(category),
        categories: categoryList,
        hideFootwear: shouldHideFootwear,

        productType: s(productType),

        hasVariants:
          hasVariants !== undefined && s(hasVariants) !== ""
            ? toBool(hasVariants)
            : undefined,

        inStock:
          inStock !== undefined && s(inStock) !== ""
            ? toBool(inStock)
            : undefined,

        isActive:
          isActive !== undefined && s(isActive) !== ""
            ? toBool(isActive)
            : undefined,

        isDraft:
          isDraft !== undefined && s(isDraft) !== ""
            ? toBool(isDraft)
            : undefined,

        isBestSeller:
          isBestSeller !== undefined && s(isBestSeller) !== ""
            ? toBool(isBestSeller)
            : undefined,

        minStock: s(minStock),
        maxStock: s(maxStock),

        minReservedStock: s(minReservedStock),
        maxReservedStock: s(maxReservedStock),

        minAvailableStock: s(minAvailableStock),
        maxAvailableStock: s(maxAvailableStock),

        sort: s(sort) || "updated_desc",
        sortKey: s(sortKey),
        sortDir: s(sortDir),
      },

      products,
    });
  } catch (error) {
    console.error("❌ getInventoryAdminProducts Error:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to fetch inventory products",
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

    const nextStock = toNonNegInt(
      req.body?.stock,
      -1
    );

    if (nextStock < 0) {
      return res.status(400).json({
        success: false,
        message:
          "stock must be a non-negative integer",
      });
    }

    const findQuery = isMongoId(rawId)
      ? { _id: rawId }
      : { productCode: rawId };

    const product =
      await Product.findOne(findQuery);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const variants = Array.isArray(
      product.variants
    )
      ? product.variants
      : [];

    const isVariable =
      product.productType === "variable" ||
      variants.length > 0;

    const reqSize = normalizeSize(
      req.body?.size
    );

    const reqVariantId = s(
      req.body?.variantId
    );

    /* ========================================================
       SIMPLE PRODUCT
    ======================================================== */
    if (!isVariable) {
      if (reqSize || reqVariantId) {
        return res.status(400).json({
          success: false,
          message:
            "This is a simple product. Do not send size/variantId for simple products.",
        });
      }

      const stockBefore = Math.max(
        0,
        Number(product.stock ?? 0)
      );

      const historyEntry =
        createInventoryHistoryEntry({
          req,
          scope: "product",
          sku: product.sku || "",
          stockBefore,
          stockAfter: nextStock,
        });

      product.stock = nextStock;
      product.markModified("stock");

      if (historyEntry) {
        if (
          !Array.isArray(
            product.inventoryHistory
          )
        ) {
          product.inventoryHistory = [];
        }

        product.inventoryHistory.push(
          historyEntry
        );

        product.markModified(
          "inventoryHistory"
        );
      }

      await product.save({
        validateBeforeSave: true,
      });

      let reconcileSummary = null;

      try {
        reconcileSummary =
          await reconcilePendingReservationsInternal(
            {
              productId: product._id,
            }
          );
      } catch (reErr) {
        console.error(
          "⚠️ reconcilePendingReservationsInternal failed (simple):",
          reErr?.message || reErr
        );
      }

      const updated =
        await Product.findById(
          product._id,
          getInventoryProjection()
        ).lean();

      return res.json({
        success: true,
        message: historyEntry
          ? `Inventory ${historyEntry.type} recorded successfully`
          : "Inventory unchanged",
        mode: "simple",

        updated: {
          productId: String(product._id),
          stockBefore,
          quantityChanged:
            historyEntry?.quantityChanged || 0,
          stock: nextStock,
        },

        inventoryMovement: historyEntry,
        reconcile: reconcileSummary,

        product:
          applyInventoryStockFromVariants(
            updated
          ),
      });
    }

    /* ========================================================
       VARIABLE PRODUCT
    ======================================================== */
    let targetVariant = null;

    if (reqVariantId) {
      targetVariant =
        variants.find(
          (variant) =>
            String(variant?._id || "") ===
            reqVariantId
        ) || null;
    }

    if (!targetVariant && reqSize) {
      targetVariant =
        variants.find(
          (variant) =>
            normalizeSize(
              getVariantSize(variant)
            ) === reqSize
        ) || null;
    }

    if (!targetVariant) {
      return res.status(400).json({
        success: false,
        message:
          "Variable product detected. Send size or variantId to update a specific variant.",
      });
    }

    const stockBefore = Math.max(
      0,
      Number(targetVariant.stock ?? 0)
    );

    const variantSize =
      getVariantSize(targetVariant) ||
      targetVariant.size ||
      "";

    const historyEntry =
      createInventoryHistoryEntry({
        req,
        scope: "variant",
        variantId: targetVariant._id,
        size: variantSize,
        sku: targetVariant.sku || "",
        stockBefore,
        stockAfter: nextStock,
      });

    targetVariant.stock = nextStock;
    product.markModified("variants");

    const totalStock = variants.reduce(
      (sum, variant) =>
        sum +
        Number(variant?.stock ?? 0),
      0
    );

    product.stock = totalStock;
    product.markModified("stock");

    if (historyEntry) {
      if (
        !Array.isArray(
          product.inventoryHistory
        )
      ) {
        product.inventoryHistory = [];
      }

      product.inventoryHistory.push(
        historyEntry
      );

      product.markModified(
        "inventoryHistory"
      );
    }

    await product.save({
      validateBeforeSave: true,
    });

    let reconcileSummary = null;

    try {
      reconcileSummary =
        await reconcilePendingReservationsInternal(
          {
            productId: product._id,
            variantId: targetVariant._id,
          }
        );
    } catch (reErr) {
      console.error(
        "⚠️ reconcilePendingReservationsInternal failed (variant):",
        reErr?.message || reErr
      );
    }

    const updated =
      await Product.findById(
        product._id,
        getInventoryProjection()
      ).lean();

    return res.json({
      success: true,
      message: historyEntry
        ? `Inventory ${historyEntry.type} recorded successfully`
        : "Inventory unchanged",
      mode: "variant",

      updated: {
        productId: String(product._id),
        variantId: String(
          targetVariant._id
        ),
        size: variantSize,
        stockBefore,
        quantityChanged:
          historyEntry?.quantityChanged || 0,
        stock: nextStock,
        totalProductStock: totalStock,
      },

      inventoryMovement: historyEntry,
      reconcile: reconcileSummary,

      product:
        applyInventoryStockFromVariants(
          updated
        ),
    });
  } catch (e) {
    console.error(
      "❌ updateSingleInventoryAdminProduct Error:",
      e
    );

    return res.status(500).json({
      success: false,
      message:
        e.message ||
        "Failed to update inventory",
    });
  }
};


/* ============================================================
   GET INVENTORY HISTORY
   GET /api/products/admin/inventory/:id/history
============================================================ */
export const getInventoryHistory = async (req, res) => {
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

    const product = await Product.findOne(findQuery)
      .select(
        "title productCode sku thumbnail variants inventoryHistory"
      )
      .populate(
        "inventoryHistory.updatedBy",
        "name email"
      )
      .lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const type = s(req.query?.type).toUpperCase();
    const variantId = s(req.query?.variantId);
    const size = normalizeSize(req.query?.size);

    const page = Math.max(
      1,
      Number.parseInt(req.query?.page, 10) || 1
    );

    const limit = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(req.query?.limit, 10) || 30
      )
    );

    let history = Array.isArray(product.inventoryHistory)
      ? product.inventoryHistory
      : [];

    if (type === "IN" || type === "OUT") {
      history = history.filter(
        (entry) => entry.type === type
      );
    }

    if (variantId) {
      history = history.filter(
        (entry) =>
          String(entry.variantId || "") === variantId
      );
    }

    if (size) {
      history = history.filter(
        (entry) =>
          normalizeSize(entry.size) === size
      );
    }

    history.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() -
        new Date(a.createdAt).getTime()
    );

    const total = history.length;
    const startIndex = (page - 1) * limit;
    const paginatedHistory = history.slice(
      startIndex,
      startIndex + limit
    );

    return res.json({
      success: true,
      product: {
        _id: product._id,
        title: product.title,
        productCode: product.productCode,
        sku: product.sku,
        thumbnail: product.thumbnail,
      },
      filters: {
        type: type || "ALL",
        variantId: variantId || null,
        size: size || null,
      },
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      history: paginatedHistory,
    });
  } catch (e) {
    console.error("❌ getInventoryHistory Error:", e);

    return res.status(500).json({
      success: false,
      message:
        e.message || "Failed to fetch inventory history",
    });
  }
};


/* ============================================================
   INVENTORY DAILY REPORT
   GET /api/products/admin/inventory/history/report
============================================================ */
export const getInventoryHistoryReport = async (
  req,
  res
) => {
  try {
    const page = Math.max(
      1,
      Number.parseInt(req.query?.page, 10) || 1
    );

    const limit = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(req.query?.limit, 10) || 30
      )
    );

    const search = s(req.query?.search);
    const type = s(req.query?.type).toUpperCase();

    const todayIndia = new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }
    ).format(new Date());

    const startDate =
      s(req.query?.startDate) || todayIndia;

    const endDate =
      s(req.query?.endDate) || startDate;

    const startAt = new Date(
      `${startDate}T00:00:00.000+05:30`
    );

    const endAt = new Date(
      `${endDate}T23:59:59.999+05:30`
    );

    if (
      Number.isNaN(startAt.getTime()) ||
      Number.isNaN(endAt.getTime())
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid date filter",
      });
    }

    const match = {
      "inventoryHistory.createdAt": {
        $gte: startAt,
        $lte: endAt,
      },
    };

    if (type === "IN" || type === "OUT") {
      match["inventoryHistory.type"] = type;
    }

    if (search) {
      const escapedSearch = escapeRegex(search);

      match.$or = [
        {
          productCode: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
        {
          title: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
        {
          sku: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
        {
          "inventoryHistory.sku": {
            $regex: escapedSearch,
            $options: "i",
          },
        },
      ];
    }

    const [result] = await Product.aggregate([
      {
        $unwind: "$inventoryHistory",
      },
      {
        $match: match,
      },
      {
        $facet: {
          logs: [
            {
              $sort: {
                "inventoryHistory.createdAt": -1,
                _id: -1,
              },
            },
            {
              $skip: (page - 1) * limit,
            },
            {
              $limit: limit,
            },
            {
              $project: {
                _id: "$inventoryHistory._id",

                productId: "$_id",
                productCode: 1,
                title: 1,
                thumbnail: 1,
                images: 1,

                type: "$inventoryHistory.type",
                scope: "$inventoryHistory.scope",
                variantId:
                  "$inventoryHistory.variantId",
                size: "$inventoryHistory.size",
                sku: "$inventoryHistory.sku",

                stockBefore:
                  "$inventoryHistory.stockBefore",

                quantityChanged:
                  "$inventoryHistory.quantityChanged",

                stockAfter:
                  "$inventoryHistory.stockAfter",

                source:
                  "$inventoryHistory.source",

                referenceId:
                  "$inventoryHistory.referenceId",

                note: "$inventoryHistory.note",

                updatedBy:
                  "$inventoryHistory.updatedBy",

                createdAt:
                  "$inventoryHistory.createdAt",
              },
            },
          ],

          summary: [
            {
              $group: {
                _id: null,

                totalMovements: {
                  $sum: 1,
                },

                totalInventoryIn: {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          "$inventoryHistory.type",
                          "IN",
                        ],
                      },
                      "$inventoryHistory.quantityChanged",
                      0,
                    ],
                  },
                },

                totalInventoryOut: {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          "$inventoryHistory.type",
                          "OUT",
                        ],
                      },
                      "$inventoryHistory.quantityChanged",
                      0,
                    ],
                  },
                },

                productIds: {
                  $addToSet: "$_id",
                },
              },
            },
            {
              $project: {
                _id: 0,
                totalMovements: 1,
                totalInventoryIn: 1,
                totalInventoryOut: 1,

                totalProducts: {
                  $size: "$productIds",
                },
              },
            },
          ],

          productSummary: [
            {
              $group: {
                _id: {
                  productId: "$_id",
                  productCode: "$productCode",
                  title: "$title",
                  thumbnail: "$thumbnail",
                },

                totalIn: {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          "$inventoryHistory.type",
                          "IN",
                        ],
                      },
                      "$inventoryHistory.quantityChanged",
                      0,
                    ],
                  },
                },

                totalOut: {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          "$inventoryHistory.type",
                          "OUT",
                        ],
                      },
                      "$inventoryHistory.quantityChanged",
                      0,
                    ],
                  },
                },

                totalMovements: {
                  $sum: 1,
                },

                lastUpdatedAt: {
                  $max: "$inventoryHistory.createdAt",
                },
              },
            },
            {
              $sort: {
                lastUpdatedAt: -1,
              },
            },
          ],
        },
      },
    ]);

    const summary = result?.summary?.[0] || {
      totalMovements: 0,
      totalInventoryIn: 0,
      totalInventoryOut: 0,
      totalProducts: 0,
    };

    const total = Number(
      summary.totalMovements || 0
    );

    return res.json({
      success: true,

      filters: {
        search,
        type:
          type === "IN" || type === "OUT"
            ? type
            : "ALL",
        startDate,
        endDate,
      },

      summary,

      productSummary:
        result?.productSummary || [],

      logs: result?.logs || [],

      pagination: {
        page,
        limit,
        total,
        pages: Math.max(
          1,
          Math.ceil(total / limit)
        ),
      },
    });
  } catch (error) {
    console.error(
      "❌ getInventoryHistoryReport Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to fetch inventory report",
    });
  }
};
