import bwipjs from "bwip-js";
import { BarcodeItem, parseBarcode, ALLOWED_SIZES } from "../BarcodeItem/BarcodeItem.js";

/**
 * Helper: consistent API error response
 */
function sendError(res, status, message, details) {
  return res.status(status).json({ ok: false, message, ...(details ? { details } : {}) });
}

/**
 * POST /api/barcodes
 * Create an item from fields: { productId, size, price }
 */
export async function createBarcodeItem(req, res) {
  try {
    const { productId, size, price } = req.body ?? {};

    const doc = await BarcodeItem.create({
      productId,
      size,
      price
    });

    return res.status(201).json({ ok: true, data: doc });
  } catch (e) {
    // Mongo duplicate key
    if (e?.code === 11000) return sendError(res, 409, "Barcode already exists", e.keyValue);
    return sendError(res, 400, e?.message || "Failed to create barcode item");
  }
}

/**
 * GET /api/barcodes
 * List, with optional search: ?q=12134  (matches barcode/productId)
 */
export async function listBarcodeItems(req, res) {
  try {
    const q = String(req.query.q ?? "").trim();

    const filter = q
      ? {
          $or: [
            { barcode: { $regex: q, $options: "i" } },
            { productId: { $regex: q, $options: "i" } },
            { size: { $regex: q, $options: "i" } }
          ]
        }
      : {};

    const items = await BarcodeItem.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    return res.json({ ok: true, data: items });
  } catch (e) {
    return sendError(res, 500, e?.message || "Failed to list items");
  }
}

/**
 * GET /api/barcodes/:id
 * Get by Mongo _id
 */
export async function getBarcodeItemById(req, res) {
  try {
    const { id } = req.params;
    const item = await BarcodeItem.findById(id).lean();
    if (!item) return sendError(res, 404, "Item not found");
    return res.json({ ok: true, data: item });
  } catch (e) {
    return sendError(res, 400, e?.message || "Invalid id");
  }
}

/**
 * GET /api/barcodes/by-barcode/:barcodeText
 * Get record by exact barcode string (URL-encoded)
 */
export async function getBarcodeItemByBarcode(req, res) {
  try {
    const barcodeText = String(req.params.barcodeText ?? "").trim();
    const item = await BarcodeItem.findOne({ barcode: barcodeText }).lean();
    if (!item) return sendError(res, 404, "Item not found");
    return res.json({ ok: true, data: item });
  } catch (e) {
    return sendError(res, 400, e?.message || "Failed to fetch by barcode");
  }
}

/**
 * POST /api/barcodes/scan
 * - validates format
 * - returns existing record if present
 * - optional: createIfMissing=true to auto-create from scan
 */
export async function scanBarcode(req, res) {
  try {
    const { barcodeText, createIfMissing = false } = req.body ?? {};
    if (!barcodeText) return sendError(res, 400, "barcodeText is required");

    // Validate string format
    parseBarcode(barcodeText);

    const existing = await BarcodeItem.findOne({ barcode: barcodeText }).lean();
    if (existing) return res.json({ ok: true, data: existing, created: false });

    if (!createIfMissing) {
      return sendError(res, 404, "Barcode valid but not found in database. Pass createIfMissing=true to auto-create.");
    }

    const docData = BarcodeItem.fromScannedBarcode(barcodeText);
    const created = await BarcodeItem.create(docData);
    return res.status(201).json({ ok: true, data: created, created: true });
  } catch (e) {
    if (e?.code === 11000) return sendError(res, 409, "Barcode already exists");
    return sendError(res, 400, e?.message || "Scan failed");
  }
}

/**
 * PATCH /api/barcodes/:id
 * Update fields (productId/size/price). Barcode will auto-regenerate.
 */
export async function updateBarcodeItem(req, res) {
  try {
    const { id } = req.params;
    const { productId, size, price } = req.body ?? {};

    const item = await BarcodeItem.findById(id);
    if (!item) return sendError(res, 404, "Item not found");

    if (productId !== undefined) item.productId = productId;
    if (size !== undefined) item.size = size;
    if (price !== undefined) item.price = price;

    await item.save(); // triggers pre-validate to re-generate barcode
    return res.json({ ok: true, data: item });
  } catch (e) {
    if (e?.code === 11000) return sendError(res, 409, "Updated barcode conflicts with existing one");
    return sendError(res, 400, e?.message || "Update failed");
  }
}

/**
 * DELETE /api/barcodes/:id
 */
export async function deleteBarcodeItem(req, res) {
  try {
    const { id } = req.params;
    const deleted = await BarcodeItem.findByIdAndDelete(id).lean();
    if (!deleted) return sendError(res, 404, "Item not found");
    return res.json({ ok: true, data: deleted });
  } catch (e) {
    return sendError(res, 400, e?.message || "Delete failed");
  }
}

/**
 * GET /api/barcodes/:id/barcode.png
 * Generates barcode image for that DB item
 */
export async function barcodePngById(req, res) {
  try {
    const { id } = req.params;
    const item = await BarcodeItem.findById(id).lean();
    if (!item) return sendError(res, 404, "Item not found");

    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text: item.barcode,
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: "center"
    });

    res.set("Content-Type", "image/png");
    return res.send(png);
  } catch (e) {
    return sendError(res, 400, e?.message || "Barcode PNG generation failed");
  }
}

/**
 * GET /api/barcodes/generate.png?productId=12134&size=M&price=1299
 * Generates barcode PNG on the fly without saving in DB
 */
export async function generateBarcodePngNoSave(req, res) {
  try {
    const productId = String(req.query.productId ?? "").trim();
    const sizeRaw = String(req.query.size ?? "").trim().toUpperCase();
    const priceRaw = String(req.query.price ?? "").trim();

    if (!productId) return sendError(res, 400, "productId is required");
    if (!sizeRaw) return sendError(res, 400, "size is required");
    if (!ALLOWED_SIZES.includes(sizeRaw)) return sendError(res, 400, `size must be one of: ${ALLOWED_SIZES.join(", ")}`);
    if (!priceRaw) return sendError(res, 400, "price is required");

    const barcodeText = `OATCLUB-${productId}-${sizeRaw}-${priceRaw}`;

    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text: barcodeText,
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: "center"
    });

    res.set("Content-Type", "image/png");
    return res.send(png);
  } catch (e) {
    return sendError(res, 400, e?.message || "PNG generation failed");
  }
}
