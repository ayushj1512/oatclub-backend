import { Router } from "express";

import {
  createBarcodeItem,
  createBarcodeBatch,
  listBarcodeItems,
  getBarcodeItemById,
  getBarcodeItemByBarcode,
  scanBarcode,
  updateBarcodeItem,
  deleteBarcodeItem,
  barcodePngById,
  generateBarcodePngNoSave,
} from "./barcodeItem.controller.js";

const router = Router();

/* =========================================================
   HEALTH
========================================================= */

router.get("/health", (req, res) => {
  return res.json({
    ok: true,
    service: "barcode-service",
    barcodeFormat:
      "PRODUCTCODE-SIZE-UNIQUEID",
    example: "00034-M-00000029",
  });
});

/* =========================================================
   CREATE AND LIST
========================================================= */

/**
 * Create one physical inventory piece.
 *
 * POST /api/barcodes
 */
router.post(
  "/barcodes",
  createBarcodeItem
);

/**
 * Create multiple individually traceable pieces.
 *
 * POST /api/barcodes/batch
 */
router.post(
  "/barcodes/batch",
  createBarcodeBatch
);

/**
 * Search and list physical pieces.
 *
 * GET /api/barcodes
 */
router.get(
  "/barcodes",
  listBarcodeItems
);

/* =========================================================
   SCAN AND LOOKUP
========================================================= */

/**
 * Scan exact piece barcode.
 *
 * POST /api/barcodes/scan
 *
 * {
 *   "barcodeText": "00034-M-00000029"
 * }
 */
router.post(
  "/barcodes/scan",
  scanBarcode
);

/**
 * Find saved physical item by exact barcode.
 *
 * GET /api/barcodes/by-barcode/00034-M-00000029
 */
router.get(
  "/barcodes/by-barcode/:barcodeText",
  getBarcodeItemByBarcode
);

/* =========================================================
   BARCODE PNG PREVIEW
========================================================= */

/**
 * Generate preview without saving.
 *
 * GET /api/barcodes/generate.png
 * ?productCode=00034
 * &size=M
 * &uniqueId=00000029
 *
 * This endpoint does not reserve a unique ID.
 * It only previews an already-known ID.
 */
router.get(
  "/barcodes/generate.png",
  generateBarcodePngNoSave
);

/* =========================================================
   CRUD BY MONGO ID
========================================================= */

/**
 * GET /api/barcodes/:id
 */
router.get(
  "/barcodes/:id",
  getBarcodeItemById
);

/**
 * PATCH /api/barcodes/:id
 *
 * Barcode identity fields remain immutable.
 */
router.patch(
  "/barcodes/:id",
  updateBarcodeItem
);

/**
 * DELETE /api/barcodes/:id
 *
 * Only completely unused items can be deleted.
 */
router.delete(
  "/barcodes/:id",
  deleteBarcodeItem
);

/* =========================================================
   SAVED BARCODE PNG
========================================================= */

/**
 * GET /api/barcodes/:id/barcode.png
 */
router.get(
  "/barcodes/:id/barcode.png",
  barcodePngById
);

export default router;