import bwipjs from "bwip-js";

import {
  BarcodeItem,
  ALLOWED_SIZES,
  makeBarcode,
  parseBarcode,
  formatSerialNumber,
} from "./BarcodeItem.js";

/* =========================================================
   CONSTANTS
========================================================= */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_BATCH_SIZE = 5000;

/* =========================================================
   HELPERS
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
    ...(details !== undefined ? { details } : {}),
  });
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeProductId(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeSize(value) {
  return normalizeText(value).toUpperCase();
}

function normalizePrice(value) {
  const price = Number(value);

  if (!Number.isFinite(price)) {
    throw new Error("price must be a valid number");
  }

  if (price < 0) {
    throw new Error(
      "price must be greater than or equal to 0"
    );
  }

  return price;
}

function normalizeQuantity(value, fallback = 1) {
  const quantity = Number(value ?? fallback);

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
      `Maximum ${MAX_BATCH_SIZE} barcodes can be generated at once`
    );
  }

  return quantity;
}

function escapeRegex(value) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
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
      Number.parseInt(query.limit, 10) ||
        DEFAULT_LIMIT
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

  if (fields.includes("serialNumber")) {
    return "Serial number already exists";
  }

  if (fields.includes("serialCode")) {
    return "Serial code already exists";
  }

  return "Duplicate barcode item";
}

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

/* =========================================================
   CREATE SINGLE BARCODE
========================================================= */

/**
 * POST /api/barcodes
 *
 * Body:
 * {
 *   "productId": "1081",
 *   "size": "XS",
 *   "price": 1499
 * }
 *
 * Serial number is generated automatically.
 */
export async function createBarcodeItem(req, res) {
  try {
    const {
      productId,
      size,
      price,
    } = req.body ?? {};

    const item = await BarcodeItem.create({
      productId,
      size,
      price,
    });

    return res.status(201).json({
      ok: true,
      message: "Barcode item created",
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
   CREATE BARCODE BATCH
========================================================= */

/**
 * POST /api/barcodes/batch
 *
 * Body:
 * {
 *   "productId": "1081",
 *   "size": "XS",
 *   "price": 1499,
 *   "quantity": 50
 * }
 */
export async function createBarcodeBatch(req, res) {
  try {
    const {
      productId,
      size,
      price,
      quantity,
    } = req.body ?? {};

    const count = normalizeQuantity(quantity);

    const items = await BarcodeItem.createBatch({
      productId,
      size,
      price,
      quantity: count,
    });

    return res.status(201).json({
      ok: true,
      message: `${items.length} barcode items created`,
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
   LIST BARCODE ITEMS
========================================================= */

/**
 * GET /api/barcodes
 *
 * Supported queries:
 *
 * ?q=1081
 * ?productId=1081
 * ?size=XS
 * ?price=1499
 * ?serialNumber=12
 * ?page=1
 * ?limit=50
 */
export async function listBarcodeItems(req, res) {
  try {
    const {
      q,
      productId,
      size,
      price,
      serialNumber,
    } = req.query ?? {};

    const {
      page,
      limit,
      skip,
    } = parsePagination(req.query);

    const filter = {};

    if (q) {
      const search = normalizeText(q);
      const escapedSearch =
        escapeRegex(search);

      const numericSearch = Number(search);

      filter.$or = [
        {
          barcode: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
        {
          productId: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
        {
          size: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
        {
          serialCode: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
      ];

      if (
        Number.isSafeInteger(numericSearch) &&
        numericSearch > 0
      ) {
        filter.$or.push({
          serialNumber: numericSearch,
        });
      }
    }

    if (productId) {
      filter.productId =
        normalizeProductId(productId);
    }

    if (size) {
      const normalizedSize =
        normalizeSize(size);

      if (
        !ALLOWED_SIZES.includes(
          normalizedSize
        )
      ) {
        return sendError(
          res,
          400,
          `size must be one of: ${ALLOWED_SIZES.join(
            ", "
          )}`
        );
      }

      filter.size = normalizedSize;
    }

    if (
      price !== undefined &&
      price !== ""
    ) {
      filter.price = normalizePrice(price);
    }

    if (
      serialNumber !== undefined &&
      serialNumber !== ""
    ) {
      const serial = Number(serialNumber);

      if (
        !Number.isSafeInteger(serial) ||
        serial <= 0
      ) {
        return sendError(
          res,
          400,
          "serialNumber must be a positive integer"
        );
      }

      filter.serialNumber = serial;
    }

    const [items, total] =
      await Promise.all([
        BarcodeItem.find(filter)
          .sort({
            createdAt: -1,
            serialNumber: -1,
          })
          .skip(skip)
          .limit(limit)
          .lean(),

        BarcodeItem.countDocuments(filter),
      ]);

    return res.json({
      ok: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    return sendError(
      res,
      500,
      error?.message ||
        "Failed to list barcode items"
    );
  }
}

/* =========================================================
   GET ITEM BY MONGO ID
========================================================= */

/**
 * GET /api/barcodes/:id
 */
export async function getBarcodeItemById(
  req,
  res
) {
  try {
    const item = await BarcodeItem.findById(
      req.params.id
    ).lean();

    if (!item) {
      return sendError(
        res,
        404,
        "Barcode item not found"
      );
    }

    return res.json({
      ok: true,
      data: item,
    });
  } catch (error) {
    return sendError(
      res,
      400,
      error?.message ||
        "Invalid barcode item id"
    );
  }
}

/* =========================================================
   GET ITEM BY EXACT BARCODE
========================================================= */

/**
 * GET /api/barcodes/by-barcode/:barcodeText
 */
export async function getBarcodeItemByBarcode(
  req,
  res
) {
  try {
    const barcodeText = decodeURIComponent(
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

    const parsed = parseBarcode(
      barcodeText
    );

    const item = await BarcodeItem.findOne({
      barcode: parsed.barcode,
    }).lean();

    if (!item) {
      return sendError(
        res,
        404,
        "Barcode item not found"
      );
    }

    return res.json({
      ok: true,
      parsed,
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
   SCAN BARCODE
========================================================= */

/**
 * POST /api/barcodes/scan
 *
 * Body:
 * {
 *   "barcodeText":
 *   "OATCLUB-1081-XS-1499-00000001"
 * }
 *
 * createIfMissing is intentionally unsupported because
 * every serial must originate from the global counter.
 */
export async function scanBarcode(req, res) {
  try {
    const barcodeText = normalizeText(
      req.body?.barcodeText
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

    const item = await BarcodeItem.findOne({
      barcode: parsed.barcode,
    }).lean();

    if (!item) {
      return sendError(
        res,
        404,
        "Barcode format is valid, but this serial is not registered"
      );
    }

    const dataMatchesBarcode =
      item.productId ===
        parsed.productId &&
      item.size === parsed.size &&
      item.price === parsed.price &&
      item.serialNumber ===
        parsed.serialNumber;

    if (!dataMatchesBarcode) {
      return sendError(
        res,
        409,
        "Barcode data does not match the stored item"
      );
    }

    return res.json({
      ok: true,
      message: "Barcode scanned successfully",
      parsed,
      data: item,
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
   UPDATE ITEM
========================================================= */

/**
 * PATCH /api/barcodes/:id
 *
 * Product, size, price and serial form the permanent
 * identity of a physical item.
 *
 * To avoid incorrect tracking, identity fields cannot
 * be changed after creation.
 */
export async function updateBarcodeItem(
  req,
  res
) {
  try {
    const item = await BarcodeItem.findById(
      req.params.id
    );

    if (!item) {
      return sendError(
        res,
        404,
        "Barcode item not found"
      );
    }

    const identityFields = [
      "productId",
      "size",
      "price",
      "serialNumber",
      "serialCode",
      "barcode",
    ];

    const requestedIdentityFields =
      identityFields.filter(
        (field) =>
          req.body?.[field] !== undefined
      );

    if (
      requestedIdentityFields.length > 0
    ) {
      return sendError(
        res,
        400,
        `Barcode identity cannot be updated. Immutable fields: ${requestedIdentityFields.join(
          ", "
        )}. Delete the unused item and generate a new barcode instead.`
      );
    }

    return res.json({
      ok: true,
      message:
        "No editable fields were provided",
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
 * DELETE /api/barcodes/:id
 *
 * This is suitable only before the barcode is used for
 * order tracking.
 */
export async function deleteBarcodeItem(
  req,
  res
) {
  try {
    const item =
      await BarcodeItem.findByIdAndDelete(
        req.params.id
      ).lean();

    if (!item) {
      return sendError(
        res,
        404,
        "Barcode item not found"
      );
    }

    return res.json({
      ok: true,
      message: "Barcode item deleted",
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
   BARCODE PNG BY SAVED ITEM
========================================================= */

/**
 * GET /api/barcodes/:id/barcode.png
 *
 * Optional:
 * ?displayValue=true
 * ?scale=3
 * ?height=12
 */
export async function barcodePngById(
  req,
  res
) {
  try {
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

    const displayValue =
      String(
        req.query.displayValue ?? "true"
      ).toLowerCase() !== "false";

    const scale = Math.min(
      6,
      Math.max(
        1,
        Number(req.query.scale) || 3
      )
    );

    const height = Math.min(
      40,
      Math.max(
        5,
        Number(req.query.height) || 12
      )
    );

    const png =
      await createBarcodeBuffer(
        item.barcode,
        {
          displayValue,
          scale,
          height,
        }
      );

    res.set({
      "Content-Type": "image/png",
      "Cache-Control":
        "private, max-age=300",
      "Content-Disposition": `inline; filename="${item.barcode}.png"`,
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
   GENERATE PNG WITHOUT SAVING
========================================================= */

/**
 * GET /api/barcodes/generate.png
 *
 * Required:
 * ?productId=1081
 * &size=XS
 * &price=1499
 * &serialNumber=1
 *
 * Important:
 * This endpoint does not reserve or create the serial.
 * It should only be used to preview an already known serial.
 */
export async function generateBarcodePngNoSave(
  req,
  res
) {
  try {
    const productId =
      normalizeProductId(
        req.query.productId
      );

    const size =
      normalizeSize(req.query.size);

    const priceRaw =
      normalizeText(req.query.price);

    const serialRaw =
      normalizeText(
        req.query.serialNumber
      );

    if (!productId) {
      return sendError(
        res,
        400,
        "productId is required"
      );
    }

    if (!size) {
      return sendError(
        res,
        400,
        "size is required"
      );
    }

    if (
      !ALLOWED_SIZES.includes(size)
    ) {
      return sendError(
        res,
        400,
        `size must be one of: ${ALLOWED_SIZES.join(
          ", "
        )}`
      );
    }

    if (!priceRaw) {
      return sendError(
        res,
        400,
        "price is required"
      );
    }

    if (!serialRaw) {
      return sendError(
        res,
        400,
        "serialNumber is required"
      );
    }

    const price =
      normalizePrice(priceRaw);

    const serialNumber =
      Number(serialRaw);

    if (
      !Number.isSafeInteger(
        serialNumber
      ) ||
      serialNumber <= 0
    ) {
      return sendError(
        res,
        400,
        "serialNumber must be a positive integer"
      );
    }

    const barcodeText =
      makeBarcode({
        productId,
        size,
        price,
        serialNumber,
      });

    const displayValue =
      String(
        req.query.displayValue ?? "true"
      ).toLowerCase() !== "false";

    const png =
      await createBarcodeBuffer(
        barcodeText,
        {
          displayValue,
        }
      );

    res.set({
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="${barcodeText}.png"`,
      "X-Barcode-Value": barcodeText,
      "X-Serial-Code":
        formatSerialNumber(
          serialNumber
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