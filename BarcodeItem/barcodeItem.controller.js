import mongoose from "mongoose";
import bwipjs from "bwip-js";
import Product from "../Products/Products.js";
import { reconcileBackordersForVariant } from "../inventoryUtility/reconcileBackordersForVariant.js";

import {
  BarcodeItem,
  ALLOWED_SIZES,
  INVENTORY_STATUSES,
  INVENTORY_SOURCES,
  MAX_BATCH_SIZE,
  makePieceSku,
  parseBarcode,
  formatUniqueId,
} from "./BarcodeItem.js";

/* =========================================================
   CONSTANTS
========================================================= */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const IMMUTABLE_FIELDS = [
  "product",
  "variantId",
  "productCode",
  "size",
  "variantSku",
  "sequence",
  "uniqueId",
  "pieceSku",
  "barcode",
];

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function sendError(
  res,
  status,
  message,
  details = undefined
) {
  return res.status(status).json({
    ok: false,
    message,
    ...(details !== undefined
      ? { details }
      : {}),
  });
}

function sendSuccess(
  res,
  {
    status = 200,
    message,
    data,
    ...extra
  }
) {
  return res.status(status).json({
    ok: true,
    ...(message ? { message } : {}),
    ...(data !== undefined
      ? { data }
      : {}),
    ...extra,
  });
}

/* =========================================================
   PRODUCT INVENTORY HELPERS
========================================================= */

const INVENTORY_SCAN_MARKER =
  "[PRODUCT-STOCK-INWARDED]";

function normalizeInventoryProductCode(
  value = ""
) {
  const raw = normalizeUppercase(value);

  if (!raw) {
    throw new Error(
      "productCode is required"
    );
  }

  if (/^\d+$/.test(raw)) {
    return String(
      Number.parseInt(raw, 10)
    ).padStart(5, "0");
  }

  return raw;
}

function buildProductCodeCandidates(
  value = ""
) {
  const raw =
    normalizeInventoryProductCode(value);

  const candidates = new Set([raw]);

  if (/^\d+$/.test(raw)) {
    const numericCode = String(
      Number.parseInt(raw, 10)
    );

    candidates.add(numericCode);
    candidates.add(
      numericCode.padStart(5, "0")
    );
    candidates.add(
      numericCode.padStart(6, "0")
    );
  }

  return Array.from(candidates);
}

function getVariantSize(variant) {
  const attributes = Array.isArray(
    variant?.attributes
  )
    ? variant.attributes
    : [];

  return normalizeUppercase(
    attributes.find(
      (attribute) =>
        normalizeText(
          attribute?.key
        ).toLowerCase() === "size"
    )?.value
  );
}

function findVariantBySize(
  product,
  size
) {
  const normalizedSize =
    validateSize(size);

  return (product?.variants || []).find(
    (variant) =>
      getVariantSize(variant) ===
      normalizedSize
  );
}

function getVendorId(req) {
  return (
    req.vendor?._id ||
    req.vendor?.id ||
    null
  );
}

function containsInventoryMarker(
  notes = ""
) {
  return normalizeText(notes).includes(
    INVENTORY_SCAN_MARKER
  );
}

function appendInventoryMarker(
  notes = ""
) {
  const currentNotes =
    normalizeText(notes);

  if (
    containsInventoryMarker(
      currentNotes
    )
  ) {
    return currentNotes;
  }

  return [
    currentNotes,
    INVENTORY_SCAN_MARKER,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildInventoryResponse(
  product,
  variant = null
) {
  const productObject =
    typeof product?.toObject === "function"
      ? product.toObject()
      : product;

  const variants = Array.isArray(
    productObject?.variants
  )
    ? productObject.variants
    : [];

  const totalStock =
    variants.length > 0
      ? variants.reduce(
          (total, item) =>
            total +
            Number(item?.stock || 0),
          0
        )
      : Number(
          productObject?.stock || 0
        );

  const totalReserved =
    variants.length > 0
      ? variants.reduce(
          (total, item) =>
            total +
            Number(
              item?.reservedStock || 0
            ),
          0
        )
      : Number(
          productObject?.reservedStock || 0
        );

  return {
    productId: productObject?._id,
    productCode:
      productObject?.productCode,
    title: productObject?.title,
    thumbnail:
      productObject?.thumbnail ||
      productObject?.images?.[0] ||
      "",
    productType:
      productObject?.productType,
    stock: totalStock,
    reservedStock: totalReserved,
    availableStock: Math.max(
      0,
      totalStock - totalReserved
    ),
    isInStock:
      totalStock - totalReserved > 0,
    variant: variant
      ? {
          variantId: variant._id,
          size: getVariantSize(
            variant
          ),
          sku: variant.sku || "",
          stock: Number(
            variant.stock || 0
          ),
          reservedStock: Number(
            variant.reservedStock || 0
          ),
          availableStock: Math.max(
            0,
            Number(
              variant.stock || 0
            ) -
              Number(
                variant.reservedStock || 0
              )
          ),
          isInStock:
            Number(
              variant.stock || 0
            ) -
              Number(
                variant.reservedStock || 0
              ) >
            0,
        }
      : null,
  };
}

async function reconcileAndRefreshInventory({
  productId,
  variantId = null,
}) {
  let reconcile = null;

  try {
    reconcile =
      await reconcileBackordersForVariant({
        productId,
        variantId,
      });
  } catch (error) {
    console.error(
      "⚠️ Vendor inventory reconcile failed:",
      error?.message || error
    );
  }

  const freshProduct =
    await Product.findById(productId);

  if (!freshProduct) {
    return {
      reconcile,
      inventory: null,
    };
  }

  const freshVariant = variantId
    ? freshProduct.variants?.id(variantId) || null
    : null;

  return {
    reconcile,
    inventory: buildInventoryResponse(
      freshProduct,
      freshVariant
    ),
  };
}

async function findProductForInventory(
  productCode,
  session = null
) {
  const candidates =
    buildProductCodeCandidates(
      productCode
    );

  let query = Product.findOne({
    productCode: {
      $in: candidates,
    },
  });

  if (session) {
    query = query.session(session);
  }

  return query;
}

async function increaseProductInventory({
  product,
  size,
  quantity,
  session = null,
}) {
  const incrementBy = Number(quantity);

  if (
    !Number.isSafeInteger(incrementBy) ||
    incrementBy <= 0
  ) {
    throw new Error(
      "quantity must be a positive integer"
    );
  }

  const hasVariants =
    Array.isArray(product.variants) &&
    product.variants.length > 0;

  /*
   * VARIABLE PRODUCT
   */
  if (hasVariants) {
    const normalizedSize =
      validateSize(size);

    const variant =
      findVariantBySize(
        product,
        normalizedSize
      );

    if (!variant) {
      throw new Error(
        `Size ${normalizedSize} variant not found for product ${product.productCode}`
      );
    }

    variant.stock =
      Number(variant.stock || 0) +
      incrementBy;

    const reservedStock =
      Math.max(
        0,
        Number(
          variant.reservedStock || 0
        )
      );

    variant.isInStock =
      variant.stock -
        reservedStock >
      0;

    product.isInStock =
      product.variants.some(
        (item) =>
          Number(item.stock || 0) -
            Number(
              item.reservedStock || 0
            ) >
          0
      );

    product.markModified(
      "variants"
    );

    await product.save({
      session,
      validateBeforeSave: true,
    });

    const updatedVariant =
      product.variants.id(
        variant._id
      );

    return {
      product,
      variant: updatedVariant,
    };
  }

  /*
   * SIMPLE PRODUCT
   */
  product.stock =
    Number(product.stock || 0) +
    incrementBy;

  const reservedStock =
    Math.max(
      0,
      Number(
        product.reservedStock || 0
      )
    );

  product.isInStock =
    product.stock -
      reservedStock >
    0;

  await product.save({
    session,
    validateBeforeSave: true,
  });

  return {
    product,
    variant: null,
  };
}

/* =========================================================
   NORMALIZERS
========================================================= */

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function normalizeUppercase(value = "") {
  return normalizeText(value).toUpperCase();
}

function normalizeProductCode(value = "") {
  return normalizeUppercase(value);
}

function normalizeSize(value = "") {
  return normalizeUppercase(value);
}

function normalizeQuantity(
  value,
  fallback = 1
) {
  const quantity = Number(
    value ?? fallback
  );

  if (
    !Number.isSafeInteger(quantity) ||
    quantity <= 0
  ) {
    throw new Error(
      "quantity must be a positive integer"
    );
  }

  if (quantity > MAX_BATCH_SIZE) {
    throw new Error(
      `Maximum ${MAX_BATCH_SIZE} barcode items can be created at once`
    );
  }

  return quantity;
}

function normalizeOptionalNumber(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error(
      "Value must be a valid number greater than or equal to 0"
    );
  }

  return number;
}

function normalizeBoolean(
  value,
  fallback = false
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return ["true", "1", "yes"].includes(
    String(value).toLowerCase()
  );
}

function escapeRegex(value = "") {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

/* =========================================================
   VALIDATION HELPERS
========================================================= */

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(
    value
  );
}

function validateOptionalObjectId(
  value,
  fieldName
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (!isValidObjectId(value)) {
    throw new Error(
      `${fieldName} must be a valid MongoDB ObjectId`
    );
  }

  return value;
}

function validateSize(size) {
  const normalizedSize =
    normalizeSize(size);

  if (
    !ALLOWED_SIZES.includes(
      normalizedSize
    )
  ) {
    throw new Error(
      `size must be one of: ${ALLOWED_SIZES.join(
        ", "
      )}`
    );
  }

  return normalizedSize;
}

function validateStatus(status) {
  const normalizedStatus =
    normalizeText(status).toLowerCase();

  if (
    !INVENTORY_STATUSES.includes(
      normalizedStatus
    )
  ) {
    throw new Error(
      `status must be one of: ${INVENTORY_STATUSES.join(
        ", "
      )}`
    );
  }

  return normalizedStatus;
}

function validateSource(source) {
  const normalizedSource =
    normalizeText(source).toLowerCase();

  if (
    !INVENTORY_SOURCES.includes(
      normalizedSource
    )
  ) {
    throw new Error(
      `source must be one of: ${INVENTORY_SOURCES.join(
        ", "
      )}`
    );
  }

  return normalizedSource;
}

function parsePagination(query = {}) {
  const page = Math.max(
    1,
    Number.parseInt(query.page, 10) || 1
  );

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(
      1,
      Number.parseInt(
        query.limit,
        10
      ) || DEFAULT_LIMIT
    )
  );

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

function getDuplicateMessage(error) {
  const fields = Object.keys(
    error?.keyValue || {}
  );

  if (fields.includes("barcode")) {
    return "Barcode already exists";
  }

  if (fields.includes("pieceSku")) {
    return "Piece SKU already exists";
  }

  if (fields.includes("uniqueId")) {
    return "Unique piece ID already exists";
  }

  if (fields.includes("sequence")) {
    return "Barcode sequence already exists";
  }

  return "Duplicate barcode item";
}

/* =========================================================
   BARCODE PNG HELPER
========================================================= */

async function createBarcodeBuffer(
  barcodeText,
  options = {}
) {
  const {
    displayValue = true,
    scale = 3,
    height = 12,
  } = options;

  return bwipjs.toBuffer({
    bcid: "code128",
    text: barcodeText,
    scale,
    height,
    includetext: displayValue,
    textxalign: "center",
    textsize: 10,
    paddingwidth: 8,
    paddingheight: 5,
    backgroundcolor: "FFFFFF",
  });
}

function getPngOptions(query = {}) {
  const displayValue = normalizeBoolean(
    query.displayValue,
    true
  );

  const scale = Math.min(
    6,
    Math.max(
      1,
      Number(query.scale) || 3
    )
  );

  const height = Math.min(
    40,
    Math.max(
      5,
      Number(query.height) || 12
    )
  );

  return {
    displayValue,
    scale,
    height,
  };
}

/* =========================================================
   CREATE SINGLE ITEM
========================================================= */

/**
 * POST /api/barcodes
 *
 * Body:
 * {
 *   "product": "mongo-product-id",
 *   "variantId": "embedded-variant-id",
 *   "productCode": "00034",
 *   "size": "M",
 *   "priceSnapshot": 1499,
 *   "mrpSnapshot": 2199,
 *   "inwardBatchCode": "BATCH-001",
 *   "source": "production"
 * }
 */
export async function createBarcodeItem(
  req,
  res
) {
  try {
    const {
      product = null,
      variantId = null,
      productCode,
      size,
      priceSnapshot = null,
      mrpSnapshot = null,
      inwardBatchCode = "",
      vendor = null,
      source = "production",
      notes = "",
    } = req.body ?? {};

    if (!normalizeProductCode(productCode)) {
      return sendError(
        res,
        400,
        "productCode is required"
      );
    }

    const normalizedSize =
      validateSize(size);

    const normalizedSource =
      validateSource(source);

    const item = await BarcodeItem.create({
      product: validateOptionalObjectId(
        product,
        "product"
      ),
      variantId: validateOptionalObjectId(
        variantId,
        "variantId"
      ),
      productCode:
        normalizeProductCode(productCode),
      size: normalizedSize,
      priceSnapshot:
        normalizeOptionalNumber(
          priceSnapshot
        ),
      mrpSnapshot:
        normalizeOptionalNumber(
          mrpSnapshot
        ),
      inwardBatchCode:
        normalizeUppercase(
          inwardBatchCode
        ),
      vendor: validateOptionalObjectId(
        vendor,
        "vendor"
      ),
      source: normalizedSource,
      notes: normalizeText(notes),
    });

    return sendSuccess(res, {
      status: 201,
      message:
        "Physical barcode item created",
      data: item,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return sendError(
        res,
        409,
        getDuplicateMessage(error),
        error.keyValue
      );
    }

    return sendError(
      res,
      400,
      error?.message ||
        "Failed to create barcode item"
    );
  }
}

/* =========================================================
   CREATE BATCH
========================================================= */

/**
 * POST /api/barcodes/batch
 *
 * Body:
 * {
 *   "productCode": "00034",
 *   "size": "M",
 *   "quantity": 50,
 *   "product": "mongo-product-id",
 *   "variantId": "embedded-variant-id",
 *   "priceSnapshot": 1499,
 *   "mrpSnapshot": 2199,
 *   "inwardBatchCode": "BATCH-001",
 *   "source": "production"
 * }
 */
export async function createBarcodeBatch(
  req,
  res
) {
  try {
    const {
      product = null,
      variantId = null,
      productCode,
      size,
      quantity,
      priceSnapshot = null,
      mrpSnapshot = null,
      inwardBatchCode = "",
      vendor = null,
      source = "production",
      notes = "",
    } = req.body ?? {};

    if (!normalizeProductCode(productCode)) {
      return sendError(
        res,
        400,
        "productCode is required"
      );
    }

    const count =
      normalizeQuantity(quantity);

    const normalizedSize =
      validateSize(size);

    const normalizedSource =
      validateSource(source);

    const items =
      await BarcodeItem.createBatch({
        product:
          validateOptionalObjectId(
            product,
            "product"
          ),
        variantId:
          validateOptionalObjectId(
            variantId,
            "variantId"
          ),
        productCode:
          normalizeProductCode(
            productCode
          ),
        size: normalizedSize,
        quantity: count,
        priceSnapshot:
          normalizeOptionalNumber(
            priceSnapshot
          ),
        mrpSnapshot:
          normalizeOptionalNumber(
            mrpSnapshot
          ),
        inwardBatchCode:
          normalizeUppercase(
            inwardBatchCode
          ),
        vendor:
          validateOptionalObjectId(
            vendor,
            "vendor"
          ),
        source: normalizedSource,
        notes: normalizeText(notes),
      });

    return sendSuccess(res, {
      status: 201,
      message: `${items.length} physical barcode items created`,
      count: items.length,
      data: items,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return sendError(
        res,
        409,
        getDuplicateMessage(error),
        error.keyValue
      );
    }

    return sendError(
      res,
      400,
      error?.message ||
        "Failed to create barcode batch"
    );
  }
}

/* =========================================================
   LIST / SEARCH
========================================================= */

/**
 * GET /api/barcodes
 *
 * Queries:
 * ?q=00034-M
 * ?productCode=00034
 * ?size=M
 * ?uniqueId=00000029
 * ?sequence=29
 * ?variantSku=00034-M
 * ?pieceSku=00034-M-00000029
 * ?status=available
 * ?source=production
 * ?assignedOrderNumber=SHOP-1234
 * ?inwardBatchCode=BATCH-001
 * ?page=1
 * ?limit=50
 */
export async function listBarcodeItems(
  req,
  res
) {
  try {
    const {
      q,
      productCode,
      size,
      uniqueId,
      sequence,
      variantSku,
      pieceSku,
      barcode,
      status,
      source,
      assignedOrderNumber,
      inwardBatchCode,
      product,
      variantId,
      vendor,
      sort = "newest",
    } = req.query ?? {};

    const {
      page,
      limit,
      skip,
    } = parsePagination(req.query);

    const filter = {};

    if (q) {
      const search = normalizeText(q);
      const escaped =
        escapeRegex(search);

      const numericSearch =
        Number(search);

      filter.$or = [
        {
          barcode: {
            $regex: escaped,
            $options: "i",
          },
        },
        {
          pieceSku: {
            $regex: escaped,
            $options: "i",
          },
        },
        {
          variantSku: {
            $regex: escaped,
            $options: "i",
          },
        },
        {
          productCode: {
            $regex: escaped,
            $options: "i",
          },
        },
        {
          uniqueId: {
            $regex: escaped,
            $options: "i",
          },
        },
        {
          assignedOrderNumber: {
            $regex: escaped,
            $options: "i",
          },
        },
        {
          inwardBatchCode: {
            $regex: escaped,
            $options: "i",
          },
        },
      ];

      if (
        Number.isSafeInteger(
          numericSearch
        ) &&
        numericSearch > 0
      ) {
        filter.$or.push({
          sequence: numericSearch,
        });
      }
    }

    if (productCode) {
      filter.productCode =
        normalizeProductCode(
          productCode
        );
    }

    if (size) {
      filter.size = validateSize(size);
    }

    if (uniqueId) {
      const numericUniqueId =
        Number(uniqueId);

      if (
        !Number.isSafeInteger(
          numericUniqueId
        ) ||
        numericUniqueId <= 0
      ) {
        return sendError(
          res,
          400,
          "uniqueId must be a positive numeric value"
        );
      }

      filter.uniqueId =
        formatUniqueId(
          numericUniqueId
        );
    }

    if (
      sequence !== undefined &&
      sequence !== ""
    ) {
      const numericSequence =
        Number(sequence);

      if (
        !Number.isSafeInteger(
          numericSequence
        ) ||
        numericSequence <= 0
      ) {
        return sendError(
          res,
          400,
          "sequence must be a positive integer"
        );
      }

      filter.sequence =
        numericSequence;
    }

    if (variantSku) {
      filter.variantSku =
        normalizeUppercase(variantSku);
    }

    if (pieceSku) {
      filter.pieceSku =
        normalizeUppercase(pieceSku);
    }

    if (barcode) {
      filter.barcode =
        normalizeUppercase(barcode);
    }

    if (status) {
      filter.status =
        validateStatus(status);
    }

    if (source) {
      filter.source =
        validateSource(source);
    }

    if (assignedOrderNumber) {
      filter.assignedOrderNumber =
        normalizeUppercase(
          assignedOrderNumber
        );
    }

    if (inwardBatchCode) {
      filter.inwardBatchCode =
        normalizeUppercase(
          inwardBatchCode
        );
    }

    if (product) {
      filter.product =
        validateOptionalObjectId(
          product,
          "product"
        );
    }

    if (variantId) {
      filter.variantId =
        validateOptionalObjectId(
          variantId,
          "variantId"
        );
    }

    if (vendor) {
      filter.vendor =
        validateOptionalObjectId(
          vendor,
          "vendor"
        );
    }

    const sortOptions = {
      newest: {
        createdAt: -1,
        sequence: -1,
      },
      oldest: {
        createdAt: 1,
        sequence: 1,
      },
      sequence_asc: {
        sequence: 1,
      },
      sequence_desc: {
        sequence: -1,
      },
      inward_oldest: {
        inwardAt: 1,
        sequence: 1,
      },
      inward_newest: {
        inwardAt: -1,
        sequence: -1,
      },
    };

    const selectedSort =
      sortOptions[sort] ||
      sortOptions.newest;

    const [items, total] =
      await Promise.all([
        BarcodeItem.find(filter)
          .populate(
            "product",
            "productCode title slug thumbnail"
          )
          .populate(
            "assignedOrder",
            "orderNumber status"
          )
          .populate(
            "vendor",
            "name username phone"
          )
          .sort(selectedSort)
          .skip(skip)
          .limit(limit)
          .lean(),

        BarcodeItem.countDocuments(
          filter
        ),
      ]);

    return sendSuccess(res, {
      data: items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(
          total / limit
        ),
        hasNextPage:
          page * limit < total,
        hasPreviousPage: page > 1,
      },
      filters: {
        q: q || "",
        productCode:
          productCode || "",
        size: size || "",
        status: status || "",
        source: source || "",
        sort,
      },
    });
  } catch (error) {
    return sendError(
      res,
      400,
      error?.message ||
        "Failed to list barcode items"
    );
  }
}

/* =========================================================
   GET BY MONGO ID
========================================================= */

export async function getBarcodeItemById(
  req,
  res
) {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(
        res,
        400,
        "Invalid barcode item id"
      );
    }

    const item =
      await BarcodeItem.findById(
        req.params.id
      )
        .populate(
          "product",
          "productCode title slug thumbnail price compareAtPrice variants"
        )
        .populate(
          "assignedOrder",
          "orderNumber status customer"
        )
        .populate(
          "vendor",
          "name username phone"
        )
        .populate(
          "assignmentHistory.performedBy",
          "name email username"
        )
        .lean();

    if (!item) {
      return sendError(
        res,
        404,
        "Barcode item not found"
      );
    }

    return sendSuccess(res, {
      data: item,
    });
  } catch (error) {
    return sendError(
      res,
      400,
      error?.message ||
        "Failed to fetch barcode item"
    );
  }
}

/* =========================================================
   GET BY BARCODE
========================================================= */

export async function getBarcodeItemByBarcode(
  req,
  res
) {
  try {
    const barcodeText =
      decodeURIComponent(
        normalizeText(
          req.params.barcodeText
        )
      ).toUpperCase();

    if (!barcodeText) {
      return sendError(
        res,
        400,
        "barcodeText is required"
      );
    }

    const parsed =
      parseBarcode(barcodeText);

    const item =
      await BarcodeItem.findOne({
        barcode: parsed.barcode,
      })
        .populate(
          "product",
          "productCode title slug thumbnail"
        )
        .populate(
          "assignedOrder",
          "orderNumber status"
        )
        .lean();

    if (!item) {
      return sendError(
        res,
        404,
        "Barcode format is valid, but this physical piece is not registered"
      );
    }

    return sendSuccess(res, {
      data: item,
      parsed,
    });
  } catch (error) {
    return sendError(
      res,
      400,
      error?.message ||
        "Failed to fetch barcode item"
    );
  }
}

/* =========================================================
   SCAN BARCODE
========================================================= */

/**
 * POST /api/barcodes/scan
 *
 * Body:
 * {
 *   "barcodeText": "00034-M-00000029"
 * }
 */
export async function scanBarcode(
  req,
  res
) {
  try {
    const barcodeText =
      normalizeUppercase(
        req.body?.barcodeText
      );

    if (!barcodeText) {
      return sendError(
        res,
        400,
        "barcodeText is required"
      );
    }

    const parsed =
      parseBarcode(barcodeText);

    const item =
      await BarcodeItem.findOne({
        barcode: parsed.barcode,
      })
        .populate(
          "product",
          "productCode title slug thumbnail"
        )
        .populate(
          "assignedOrder",
          "orderNumber status"
        );

    if (!item) {
      return sendError(
        res,
        404,
        "Barcode format is valid, but this physical piece is not registered"
      );
    }

    const matches =
      item.productCode ===
        parsed.productCode &&
      item.size === parsed.size &&
      item.sequence ===
        parsed.sequence &&
      item.uniqueId ===
        parsed.uniqueId &&
      item.pieceSku ===
        parsed.pieceSku &&
      item.barcode ===
        parsed.barcode;

    if (!matches) {
      return sendError(
        res,
        409,
        "Scanned barcode data does not match the stored physical item"
      );
    }

    return sendSuccess(res, {
      message:
        "Physical item scanned successfully",
      parsed,
      data: item,
      tracking: {
        status: item.status,
        assignedOrder:
          item.assignedOrder,
        assignedOrderNumber:
          item.assignedOrderNumber,
        assignedAt:
          item.assignedAt,
        packedAt: item.packedAt,
        shippedAt: item.shippedAt,
        deliveredAt:
          item.deliveredAt,
      },
    });
  } catch (error) {
    return sendError(
      res,
      400,
      error?.message ||
        "Barcode scan failed"
    );
  }
}

/* =========================================================
   UPDATE MUTABLE FIELDS
========================================================= */

/**
 * PATCH /api/barcodes/:id
 *
 * Allowed:
 * status
 * priceSnapshot
 * mrpSnapshot
 * inwardBatchCode
 * inwardAt
 * vendor
 * source
 * notes
 *
 * Identity fields cannot be changed.
 */
export async function updateBarcodeItem(
  req,
  res
) {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(
        res,
        400,
        "Invalid barcode item id"
      );
    }

    const requestedIdentityFields =
      IMMUTABLE_FIELDS.filter(
        (field) =>
          req.body?.[field] !==
          undefined
      );

    if (
      requestedIdentityFields.length > 0
    ) {
      return sendError(
        res,
        400,
        `Barcode identity cannot be updated. Immutable fields: ${requestedIdentityFields.join(
          ", "
        )}`
      );
    }

    const item =
      await BarcodeItem.findById(
        req.params.id
      );

    if (!item) {
      return sendError(
        res,
        404,
        "Barcode item not found"
      );
    }

    const {
      status,
      priceSnapshot,
      mrpSnapshot,
      inwardBatchCode,
      inwardAt,
      vendor,
      source,
      notes,
    } = req.body ?? {};

    if (status !== undefined) {
      const normalizedStatus =
        validateStatus(status);

      if (
        item.assignedOrderNumber &&
        normalizedStatus ===
          "available"
      ) {
        return sendError(
          res,
          409,
          "Assigned piece cannot be marked available directly. Release it from the order first."
        );
      }

      item.status =
        normalizedStatus;
    }

    if (
      priceSnapshot !== undefined
    ) {
      item.priceSnapshot =
        normalizeOptionalNumber(
          priceSnapshot
        );
    }

    if (
      mrpSnapshot !== undefined
    ) {
      item.mrpSnapshot =
        normalizeOptionalNumber(
          mrpSnapshot
        );
    }

    if (
      inwardBatchCode !== undefined
    ) {
      item.inwardBatchCode =
        normalizeUppercase(
          inwardBatchCode
        );
    }

    if (inwardAt !== undefined) {
      const parsedDate =
        new Date(inwardAt);

      if (
        Number.isNaN(
          parsedDate.getTime()
        )
      ) {
        return sendError(
          res,
          400,
          "inwardAt must be a valid date"
        );
      }

      item.inwardAt = parsedDate;
    }

    if (vendor !== undefined) {
      item.vendor =
        validateOptionalObjectId(
          vendor,
          "vendor"
        );
    }

    if (source !== undefined) {
      item.source =
        validateSource(source);
    }

    if (notes !== undefined) {
      item.notes =
        normalizeText(notes);
    }

    await item.save();

    return sendSuccess(res, {
      message:
        "Barcode item updated",
      data: item,
    });
  } catch (error) {
    return sendError(
      res,
      400,
      error?.message ||
        "Failed to update barcode item"
    );
  }
}

/* =========================================================
   DELETE ITEM
========================================================= */

/**
 * Barcode can only be deleted if it was never used.
 */
export async function deleteBarcodeItem(
  req,
  res
) {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(
        res,
        400,
        "Invalid barcode item id"
      );
    }

    const item =
      await BarcodeItem.findById(
        req.params.id
      );

    if (!item) {
      return sendError(
        res,
        404,
        "Barcode item not found"
      );
    }

    const hasTrackingHistory =
      Array.isArray(
        item.assignmentHistory
      ) &&
      item.assignmentHistory.length > 0;

    const isAssigned =
      Boolean(
        item.assignedOrder ||
          item.assignedOrderNumber
      );

    if (
      hasTrackingHistory ||
      isAssigned ||
      item.status !== "available"
    ) {
      return sendError(
        res,
        409,
        "This physical item has inventory or order history and cannot be deleted. Mark it as removed instead."
      );
    }

    await item.deleteOne();

    return sendSuccess(res, {
      message:
        "Unused barcode item deleted",
      data: item,
    });
  } catch (error) {
    return sendError(
      res,
      400,
      error?.message ||
        "Failed to delete barcode item"
    );
  }
}

/* =========================================================
   SAVED BARCODE PNG
========================================================= */

export async function barcodePngById(
  req,
  res
) {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(
        res,
        400,
        "Invalid barcode item id"
      );
    }

    const item =
      await BarcodeItem.findById(
        req.params.id
      ).lean();

    if (!item) {
      return sendError(
        res,
        404,
        "Barcode item not found"
      );
    }

    const options =
      getPngOptions(req.query);

    const png =
      await createBarcodeBuffer(
        item.barcode,
        options
      );

    res.set({
      "Content-Type": "image/png",
      "Cache-Control":
        "private, max-age=300",
      "Content-Disposition": `inline; filename="${item.barcode}.png"`,
      "X-Barcode-Value":
        item.barcode,
      "X-Product-Code":
        item.productCode,
      "X-Size": item.size,
      "X-Unique-Id":
        item.uniqueId,
    });

    return res.send(png);
  } catch (error) {
    return sendError(
      res,
      400,
      error?.message ||
        "Barcode PNG generation failed"
    );
  }
}

/* =========================================================
   PNG PREVIEW WITHOUT SAVING
========================================================= */

/**
 * GET /api/barcodes/generate.png
 *
 * ?productCode=00034
 * &size=M
 * &uniqueId=00000029
 *
 * Or:
 *
 * ?productCode=00034
 * &size=M
 * &sequence=29
 */
export async function generateBarcodePngNoSave(
  req,
  res
) {
  try {
    const productCode =
      normalizeProductCode(
        req.query.productCode
      );

    const size =
      validateSize(req.query.size);

    const uniqueIdRaw =
      normalizeText(
        req.query.uniqueId
      );

    const sequenceRaw =
      normalizeText(
        req.query.sequence
      );

    if (!productCode) {
      return sendError(
        res,
        400,
        "productCode is required"
      );
    }

    if (
      !uniqueIdRaw &&
      !sequenceRaw
    ) {
      return sendError(
        res,
        400,
        "uniqueId or sequence is required"
      );
    }

    let numericSequence;

    if (uniqueIdRaw) {
      numericSequence =
        Number(uniqueIdRaw);
    } else {
      numericSequence =
        Number(sequenceRaw);
    }

    if (
      !Number.isSafeInteger(
        numericSequence
      ) ||
      numericSequence <= 0
    ) {
      return sendError(
        res,
        400,
        "uniqueId or sequence must be a positive integer"
      );
    }

    const uniqueId =
      formatUniqueId(
        numericSequence
      );

    const barcodeText =
      makePieceSku({
        productCode,
        size,
        uniqueId,
      });

    const parsed =
      parseBarcode(barcodeText);

    const options =
      getPngOptions(req.query);

    const png =
      await createBarcodeBuffer(
        barcodeText,
        options
      );

    res.set({
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="${barcodeText}.png"`,
      "X-Barcode-Value":
        barcodeText,
      "X-Product-Code":
        parsed.productCode,
      "X-Size": parsed.size,
      "X-Unique-Id":
        parsed.uniqueId,
      "X-Sequence": String(
        parsed.sequence
      ),
    });

    return res.send(png);
  } catch (error) {
    return sendError(
      res,
      400,
      error?.message ||
        "Barcode PNG generation failed"
    );
  }
}

/* =========================================================
   GROUPED BARCODE INVENTORY
========================================================= */

const INVENTORY_SIZE_ORDER = [
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "3XL",
  "4XL",
  "5XL",
  "FREE",
];

/**
 * GET /api/barcodes/inventory-summary
 *
 * Query:
 * ?q=00034
 * ?status=available
 * ?page=1
 * ?limit=50
 */
export async function getBarcodeInventorySummary(
  req,
  res
) {
  try {
    const {
      q = "",
      status = "",
      page = 1,
      limit = 50,
    } = req.query ?? {};

    const currentPage = Math.max(
      1,
      Number.parseInt(page, 10) || 1
    );

    const pageLimit = Math.min(
      200,
      Math.max(
        1,
        Number.parseInt(limit, 10) || 50
      )
    );

    const match = {};

    const search = normalizeText(q);

    if (search) {
      match.$or = [
        {
          productCode: {
            $regex: escapeRegex(search),
            $options: "i",
          },
        },
        {
          variantSku: {
            $regex: escapeRegex(search),
            $options: "i",
          },
        },
        {
          barcode: {
            $regex: escapeRegex(search),
            $options: "i",
          },
        },
      ];
    }

    if (status) {
      match.status = validateStatus(status);
    }

    /*
     * Enable this only when vendor should see
     * barcode items assigned to them.
     */
    const vendorId =
      req.vendor?._id || req.vendor?.id;

    if (vendorId) {
      match.vendor =
        new mongoose.Types.ObjectId(vendorId);
    }

    const skip =
      (currentPage - 1) * pageLimit;

    const [result] =
      await BarcodeItem.aggregate([
        {
          $match: match,
        },

        /*
         * First group:
         * Product code + individual size
         */
        {
          $group: {
            _id: {
              productCode: "$productCode",
              size: "$size",
            },

            quantity: {
              $sum: 1,
            },

            availableQuantity: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      "$status",
                      "available",
                    ],
                  },
                  1,
                  0,
                ],
              },
            },

            reservedQuantity: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      "$status",
                      [
                        "reserved",
                        "allocated",
                        "packed",
                      ],
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },

        /*
         * Second group:
         * One row per product
         */
        {
          $group: {
            _id: "$_id.productCode",

            sizes: {
              $push: {
                size: "$_id.size",
                quantity: "$quantity",
                availableQuantity:
                  "$availableQuantity",
                reservedQuantity:
                  "$reservedQuantity",
              },
            },

            finalQuantity: {
              $sum: "$quantity",
            },

            availableQuantity: {
              $sum: "$availableQuantity",
            },

            reservedQuantity: {
              $sum: "$reservedQuantity",
            },
          },
        },

        /*
         * Product image and title
         */
        {
          $lookup: {
            from: "products",
            localField: "_id",
            foreignField: "productCode",
            as: "product",
          },
        },

        {
          $unwind: {
            path: "$product",
            preserveNullAndEmptyArrays: true,
          },
        },

        {
          $project: {
            _id: 0,

            productId: "$product._id",
            productCode: "$_id",

            title: {
              $ifNull: [
                "$product.title",
                "",
              ],
            },

            image: {
              $ifNull: [
                "$product.thumbnail",
                {
                  $arrayElemAt: [
                    "$product.images",
                    0,
                  ],
                },
              ],
            },

            sizes: 1,
            finalQuantity: 1,
            availableQuantity: 1,
            reservedQuantity: 1,
          },
        },

        {
          $sort: {
            productCode: 1,
          },
        },

        {
          $facet: {
            rows: [
              {
                $skip: skip,
              },
              {
                $limit: pageLimit,
              },
            ],

            pagination: [
              {
                $count: "total",
              },
            ],
          },
        },
      ]);

    const rows = (result?.rows || []).map(
      (row) => {
        const quantities = {};

        INVENTORY_SIZE_ORDER.forEach(
          (size) => {
            quantities[size] = 0;
          }
        );

        for (const sizeRow of row.sizes || []) {
          quantities[sizeRow.size] =
            Number(sizeRow.quantity || 0);
        }

        return {
          productId: row.productId || null,
          productCode: row.productCode,
          title: row.title || "",
          image: row.image || "",
          quantities,

          finalQuantity: Number(
            row.finalQuantity || 0
          ),

          availableQuantity: Number(
            row.availableQuantity || 0
          ),

          reservedQuantity: Number(
            row.reservedQuantity || 0
          ),
        };
      }
    );

    const total =
      result?.pagination?.[0]?.total || 0;

    return sendSuccess(res, {
      data: {
        sizes: INVENTORY_SIZE_ORDER,
        rows,

        pagination: {
          page: currentPage,
          limit: pageLimit,
          total,
          totalPages: Math.ceil(
            total / pageLimit
          ),
        },
      },
    });
  } catch (error) {
    return sendError(
      res,
      500,
      error?.message ||
        "Failed to load barcode inventory"
    );
  }
}


/* =========================================================
   SCAN BARCODE INTO PRODUCT INVENTORY
========================================================= */

/**
 * POST /api/barcodes/inventory/scan
 *
 * Body:
 * {
 *   "barcodeText": "00034-M-29"
 * }
 *
 * Existing registered barcode verify karega.
 * Product variant stock +1 karega.
 * Same barcode dobara inward nahi hoga.
 */
export async function scanInventoryBarcode(
  req,
  res
) {
  const session =
    await mongoose.startSession();

  try {
    const barcodeText =
      normalizeUppercase(
        req.body?.barcodeText
      );

    if (!barcodeText) {
      return sendError(
        res,
        400,
        "barcodeText is required"
      );
    }

    const parsed =
      parseBarcode(barcodeText);

    let responseData = null;

    let reconcileProductId = null;
    let reconcileVariantId = null;

    await session.withTransaction(
      async () => {
        const item =
          await BarcodeItem.findOne({
            barcode: parsed.barcode,
          }).session(session);

        if (!item) {
          const error = new Error(
            "Barcode is valid, but this physical item is not registered"
          );

          error.statusCode = 404;
          throw error;
        }

        const barcodeMatches =
          item.productCode ===
          parsed.productCode &&
          item.size === parsed.size &&
          item.sequence ===
          parsed.sequence &&
          item.uniqueId ===
          parsed.uniqueId &&
          item.pieceSku ===
          parsed.pieceSku &&
          item.barcode ===
          parsed.barcode;

        if (!barcodeMatches) {
          const error = new Error(
            "Scanned barcode does not match the registered physical item"
          );

          error.statusCode = 409;
          throw error;
        }

        if (
          containsInventoryMarker(
            item.notes
          )
        ) {
          const error = new Error(
            "This barcode has already been added to product inventory"
          );

          error.statusCode = 409;

          error.details = {
            barcode: item.barcode,
            productCode:
              item.productCode,
            size: item.size,
          };

          throw error;
        }

        let product = null;

        if (item.product) {
          product =
            await Product.findById(
              item.product
            ).session(session);
        }

        if (!product) {
          product =
            await findProductForInventory(
              parsed.productCode,
              session
            );
        }

        if (!product) {
          const error = new Error(
            `Product ${parsed.productCode} not found`
          );

          error.statusCode = 404;
          throw error;
        }

        if (
          normalizeInventoryProductCode(
            product.productCode
          ) !==
          normalizeInventoryProductCode(
            parsed.productCode
          )
        ) {
          const error = new Error(
            "Barcode product code does not match the selected product"
          );

          error.statusCode = 409;
          throw error;
        }

        const {
          product: updatedProduct,
          variant,
        } =
          await increaseProductInventory({
            product,
            size: parsed.size,
            quantity: 1,
            session,
          });

        item.product =
          updatedProduct._id;

        if (variant?._id) {
          item.variantId =
            variant._id;
        }

        const vendorId =
          getVendorId(req);

        if (vendorId) {
          item.vendor = vendorId;
        }

        item.source = "vendor";
        item.inwardAt = new Date();

        item.notes =
          appendInventoryMarker(
            item.notes
          );

        await item.save({
          session,
          validateBeforeSave: true,
        });

        reconcileProductId =
          updatedProduct._id;

        reconcileVariantId =
          variant?._id || null;

        responseData = {
          barcodeItem: {
            _id: item._id,
            barcode: item.barcode,
            pieceSku:
              item.pieceSku,
            productCode:
              item.productCode,
            size: item.size,
            status: item.status,
            source: item.source,
            inwardAt:
              item.inwardAt,
          },

          incrementedBy: 1,
        };
      }
    );

    /*
     * Transaction complete first.
     * Then reconcile reservations.
     */
    const reconciled =
      await reconcileAndRefreshInventory({
        productId:
          reconcileProductId,

        variantId:
          reconcileVariantId,
      });

    responseData.inventory =
      reconciled.inventory;

    responseData.reconcile =
      reconciled.reconcile;

    return sendSuccess(res, {
      message:
        "Barcode scanned, inventory increased and reservations reconciled",

      data: responseData,
    });
  } catch (error) {
    console.error(
      "❌ Scan Inventory Barcode Error:",
      error
    );

    return sendError(
      res,
      error?.statusCode || 400,

      error?.message ||
      "Failed to scan inventory barcode",

      error?.details
    );
  } finally {
    await session.endSession();
  }
}

/* =========================================================
   MANUAL PRODUCT INVENTORY
========================================================= */

/**
 * POST /api/barcodes/inventory/manual
 *
 * Variable product:
 * {
 *   "productCode": "00034",
 *   "size": "M",
 *   "quantity": 10
 * }
 *
 * Simple product:
 * {
 *   "productCode": "00034",
 *   "quantity": 10
 * }
 *
 * This endpoint only updates Product inventory.
 * It does not create BarcodeItem records.
 */
export async function addManualProductInventory(
  req,
  res
) {
  try {
    const {
      productCode,
      size = "",
      quantity,
    } = req.body ?? {};

    const normalizedProductCode =
      normalizeInventoryProductCode(
        productCode
      );

    const incrementBy =
      normalizeQuantity(quantity);

    const product =
      await findProductForInventory(
        normalizedProductCode
      );

    if (!product) {
      return sendError(
        res,
        404,
        `Product ${normalizedProductCode} not found`
      );
    }

    const hasVariants =
      Array.isArray(
        product.variants
      ) &&
      product.variants.length > 0;

    if (
      hasVariants &&
      !normalizeText(size)
    ) {
      return sendError(
        res,
        400,
        "size is required for variable products"
      );
    }

    const {
      product: updatedProduct,
      variant,
    } =
      await increaseProductInventory({
        product,
        size,
        quantity: incrementBy,
      });

    /*
     * Stock updated.
     * Now reserve pending orders
     * and fetch fresh inventory.
     */
    const reconciled =
      await reconcileAndRefreshInventory({
        productId:
          updatedProduct._id,

        variantId:
          variant?._id || null,
      });

    return sendSuccess(res, {
      message: hasVariants
        ? `${incrementBy} unit(s) added to size ${normalizeUppercase(
          size
        )} and reconciled`
        : `${incrementBy} unit(s) added and reconciled`,

      data: {
        inventory:
          reconciled.inventory ||
          buildInventoryResponse(
            updatedProduct,
            variant
          ),

        reconcile:
          reconciled.reconcile,

        incrementedBy:
          incrementBy,

        method: "manual",

        vendorId:
          getVendorId(req),
      },
    });
  } catch (error) {
    console.error(
      "❌ Manual Inventory Error:",
      error
    );

    return sendError(
      res,
      400,

      error?.message ||
      "Failed to add manual inventory"
    );
  }
}
