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
                  },
                ],
              },
            },
          },
        },
      },

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
                  $gt: ["$availableInventory", 0],
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

      let reconcileSummary = null;
      try {
        reconcileSummary = await reconcilePendingReservationsInternal({
          productId: product._id,
        });
      } catch (reErr) {
        console.error(
          "⚠️ reconcilePendingReservationsInternal failed (simple):",
          reErr?.message || reErr
        );
      }

      const updated = await Product.findById(
        product._id,
        getInventoryProjection()
      ).lean();

      return res.json({
        success: true,
        message: "Simple product inventory updated successfully",
        mode: "simple",
        updated: {
          productId: String(product._id),
          stock: nextStock,
        },
        reconcile: reconcileSummary,
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
      reconcileSummary = await reconcilePendingReservationsInternal({
        productId: product._id,
        variantId: targetVariant._id,
      });
    } catch (reErr) {
      console.error(
        "⚠️ reconcilePendingReservationsInternal failed (variant):",
        reErr?.message || reErr
      );
    }

    const updated = await Product.findById(
      product._id,
      getInventoryProjection()
    ).lean();

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
