import mongoose from "mongoose";
import bwipjs from "bwip-js";

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