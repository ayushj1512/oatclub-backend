import Product from "../Products.js";
import ProductCosting from "./ProductCosting.js";

/* =========================================================
   HELPERS
========================================================= */

const s = (value = "") => String(value ?? "").trim();

const safeNumber = (value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const num = Number(value);

  return Number.isFinite(num) && num >= 0
    ? num
    : undefined;
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildPayload = (body = {}) => {
  const fields = [
    "fabricCost",
    "trimsCost",
    "cuttingCost",
    "stitchingCost",
    "finishingCost",
    "ironingCost",
    "packagingCost",
    "miscellaneousCost",
  ];

  const payload = {};

  for (const field of fields) {
    const value = safeNumber(body[field]);

    if (value !== undefined) {
      payload[field] = value;
    }
  }

  if (body.note !== undefined) {
    payload.note = s(body.note);
  }

  return payload;
};

/* =========================================================
   GET ALL COSTINGS
========================================================= */

export const getProductCostings = async (req, res) => {
  try {
    const {
      q = "",
      productCode = "",

      minFabricCost,
      maxFabricCost,

      minStitchingCost,
      maxStitchingCost,

      minPackagingCost,
      maxPackagingCost,

      createdFrom,
      createdTo,

      updatedFrom,
      updatedTo,

      sortBy = "updatedAt",
      sortOrder = "desc",

      page = 1,
      limit = 50,
      all = "false",
    } = req.query;

    const filter = {};

    /* -----------------------------------------------------
       PRODUCT CODE
    ----------------------------------------------------- */

    if (s(productCode)) {
      filter.productCode = s(productCode);
    }

    /* -----------------------------------------------------
       COST FILTERS
    ----------------------------------------------------- */

    const range = (field, min, max) => {
      const minValue = safeNumber(min);
      const maxValue = safeNumber(max);

      if (minValue === undefined && maxValue === undefined) {
        return;
      }

      filter[field] = {};

      if (minValue !== undefined) {
        filter[field].$gte = minValue;
      }

      if (maxValue !== undefined) {
        filter[field].$lte = maxValue;
      }
    };

    range("fabricCost", minFabricCost, maxFabricCost);
    range("stitchingCost", minStitchingCost, maxStitchingCost);
    range("packagingCost", minPackagingCost, maxPackagingCost);

    /* -----------------------------------------------------
       DATE FILTERS
    ----------------------------------------------------- */

    const dateRange = (field, from, to) => {
      if (!from && !to) return;

      filter[field] = {};

      if (from) {
        const date = new Date(from);

        if (!Number.isNaN(date.getTime())) {
          filter[field].$gte = date;
        }
      }

      if (to) {
        const date = new Date(to);

        if (!Number.isNaN(date.getTime())) {
          filter[field].$lte = date;
        }
      }
    };

    dateRange("createdAt", createdFrom, createdTo);
    dateRange("updatedAt", updatedFrom, updatedTo);

    /* -----------------------------------------------------
       SEARCH PRODUCT CODE / TITLE
    ----------------------------------------------------- */

    if (s(q)) {
      const regex = new RegExp(
        escapeRegex(s(q)),
        "i",
      );

      const products = await Product.find({
        $or: [
          { productCode: regex },
          { title: regex },
        ],
      })
        .select("productCode")
        .lean();

      const codes = products.map(
        (product) => product.productCode,
      );

      if (filter.productCode) {
        if (!codes.includes(filter.productCode)) {
          return res.json({
            ok: true,
            data: [],
            pagination: {
              page: 1,
              limit: 0,
              total: 0,
              pages: 0,
            },
          });
        }
      } else {
        filter.productCode = {
          $in: codes,
        };
      }
    }

    /* -----------------------------------------------------
       SORTING
    ----------------------------------------------------- */

    const allowedSortFields = [
      "productCode",
      "fabricCost",
      "trimsCost",
      "cuttingCost",
      "stitchingCost",
      "finishingCost",
      "ironingCost",
      "packagingCost",
      "miscellaneousCost",
      "createdAt",
      "updatedAt",
    ];

    const normalizedSortBy = allowedSortFields.includes(sortBy)
      ? sortBy
      : "updatedAt";

    const sort = {
      [normalizedSortBy]:
        String(sortOrder).toLowerCase() === "asc"
          ? 1
          : -1,
    };

    /* -----------------------------------------------------
       PAGINATION
    ----------------------------------------------------- */

    const currentPage = Math.max(
      1,
      Number(page) || 1,
    );

    const pageLimit = Math.min(
      200,
      Math.max(1, Number(limit) || 50),
    );

    const query = ProductCosting.find(filter).sort(sort);

    if (String(all).toLowerCase() !== "true") {
      query
        .skip((currentPage - 1) * pageLimit)
        .limit(pageLimit);
    }

    const [costings, total] = await Promise.all([
      query.lean({ virtuals: true }),
      ProductCosting.countDocuments(filter),
    ]);

    /* -----------------------------------------------------
       ATTACH PRODUCT INFO
    ----------------------------------------------------- */

    const productCodes = costings.map(
      (item) => item.productCode,
    );

    const products = await Product.find({
      productCode: {
        $in: productCodes,
      },
    })
      .select(
        "productCode title thumbnail images price compareAtPrice",
      )
      .lean();

    const productMap = new Map(
      products.map((product) => [
        product.productCode,
        product,
      ]),
    );

    const data = costings.map((costing) => ({
      ...costing,

      manufacturingCost:
        Number(costing.fabricCost || 0) +
        Number(costing.trimsCost || 0) +
        Number(costing.cuttingCost || 0) +
        Number(costing.stitchingCost || 0) +
        Number(costing.finishingCost || 0) +
        Number(costing.ironingCost || 0) +
        Number(costing.packagingCost || 0) +
        Number(costing.miscellaneousCost || 0),

      product:
        productMap.get(costing.productCode) || null,
    }));

    return res.json({
      ok: true,
      data,

      filters: {
        q,
        productCode,
        sortBy: normalizedSortBy,
        sortOrder,
      },

      pagination: {
        page: currentPage,
        limit:
          String(all).toLowerCase() === "true"
            ? total
            : pageLimit,
        total,
        pages:
          String(all).toLowerCase() === "true"
            ? 1
            : Math.ceil(total / pageLimit),
      },
    });
  } catch (error) {
    console.error(
      "getProductCostings error:",
      error,
    );

    return res.status(500).json({
      ok: false,
      message: "Failed to fetch product costings",
    });
  }
};

/* =========================================================
   GET SINGLE PRODUCT COSTING
========================================================= */

export const getProductCostingByCode = async (
  req,
  res,
) => {
  try {
    const productCode = s(
      req.params.productCode,
    );

    const {
      sortBy = "updatedAt",
      sortOrder = "desc",
    } = req.query;

    if (!productCode) {
      return res.status(400).json({
        ok: false,
        message: "Product code is required",
      });
    }

    const product = await Product.findOne({
      productCode,
    })
      .select(
        "productCode title thumbnail images price compareAtPrice",
      )
      .lean();

    if (!product) {
      return res.status(404).json({
        ok: false,
        message: "Product not found",
      });
    }

    const allowedSortFields = [
      "createdAt",
      "updatedAt",
      "productCode",
    ];

    const normalizedSortBy = allowedSortFields.includes(sortBy)
      ? sortBy
      : "updatedAt";

    const costing = await ProductCosting.findOne({
      productCode,
    })
      .sort({
        [normalizedSortBy]:
          String(sortOrder).toLowerCase() === "asc"
            ? 1
            : -1,
      })
      .lean({ virtuals: true });

    if (!costing) {
      return res.json({
        ok: true,
        product,
        costing: null,
      });
    }

    const manufacturingCost =
      Number(costing.fabricCost || 0) +
      Number(costing.trimsCost || 0) +
      Number(costing.cuttingCost || 0) +
      Number(costing.stitchingCost || 0) +
      Number(costing.finishingCost || 0) +
      Number(costing.ironingCost || 0) +
      Number(costing.packagingCost || 0) +
      Number(costing.miscellaneousCost || 0);

    return res.json({
      ok: true,

      product,

      costing: {
        ...costing,
        manufacturingCost,
      },
    });
  } catch (error) {
    console.error(
      "getProductCostingByCode error:",
      error,
    );

    return res.status(500).json({
      ok: false,
      message: "Failed to fetch product costing",
    });
  }
};

/* =========================================================
   CREATE / UPDATE
========================================================= */

export const upsertProductCosting = async (
  req,
  res,
) => {
  try {
    const productCode = s(
      req.params.productCode ||
      req.body.productCode,
    );

    if (!productCode) {
      return res.status(400).json({
        ok: false,
        message: "Product code is required",
      });
    }

    const product = await Product.findOne({
      productCode,
    })
      .select("_id productCode title")
      .lean();

    if (!product) {
      return res.status(404).json({
        ok: false,
        message: "Product not found",
      });
    }

    const payload = buildPayload(req.body);

    const costing =
      await ProductCosting.findOneAndUpdate(
        {
          productCode,
        },
        {
          $set: payload,
          $setOnInsert: {
            productCode,
          },
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
        },
      );

    return res.json({
      ok: true,
      message: "Product costing saved successfully",
      costing,
    });
  } catch (error) {
    console.error(
      "upsertProductCosting error:",
      error,
    );

    return res.status(500).json({
      ok: false,
      message: "Failed to save product costing",
    });
  }
};

/* =========================================================
   DELETE
========================================================= */

export const deleteProductCosting = async (
  req,
  res,
) => {
  try {
    const productCode = s(
      req.params.productCode,
    );

    if (!productCode) {
      return res.status(400).json({
        ok: false,
        message: "Product code is required",
      });
    }

    const costing =
      await ProductCosting.findOneAndDelete({
        productCode,
      });

    if (!costing) {
      return res.status(404).json({
        ok: false,
        message: "Product costing not found",
      });
    }

    return res.json({
      ok: true,
      message: "Product costing deleted successfully",
    });
  } catch (error) {
    console.error(
      "deleteProductCosting error:",
      error,
    );

    return res.status(500).json({
      ok: false,
      message: "Failed to delete product costing",
    });
  }
};
