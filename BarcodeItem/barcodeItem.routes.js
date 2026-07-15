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
} from "../BarcodeItem/barcodeItem.controller.js";

const router = Router();

/* =========================================================
   HEALTH
========================================================= */

router.get("/health", (req, res) => {
  return res.json({
    ok: true,
    service: "barcode-service",
  });
});

/* =========================================================
   CREATE AND LIST
========================================================= */

// Create one physical barcode item
router.post("/barcodes", createBarcodeItem);

// Create multiple physical barcode items with unique serials
router.post("/barcodes/batch", createBarcodeBatch);

// List/search barcode items
router.get("/barcodes", listBarcodeItems);

/* =========================================================
   SCAN AND LOOKUP
========================================================= */

// Scan exact barcode text
router.post("/barcodes/scan", scanBarcode);

// Fetch saved item using exact barcode text
router.get(
  "/barcodes/by-barcode/:barcodeText",
  getBarcodeItemByBarcode
);

/* =========================================================
   BARCODE PNG PREVIEW
========================================================= */

/**
 * Preview an already-known barcode without saving.
 *
 * Example:
 * /barcodes/generate.png
 * ?productId=1081
 * &size=XS
 * &price=1499
 * &serialNumber=1
 */
router.get(
  "/barcodes/generate.png",
  generateBarcodePngNoSave
);

/* =========================================================
   CRUD BY MONGO ID
========================================================= */

// Fetch one saved barcode item
router.get("/barcodes/:id", getBarcodeItemById);

// Barcode identity fields are immutable
router.patch("/barcodes/:id", updateBarcodeItem);

// Delete unused barcode item
router.delete("/barcodes/:id", deleteBarcodeItem);

/* =========================================================
   SAVED BARCODE PNG
========================================================= */

// Generate barcode PNG for a saved item
router.get(
  "/barcodes/:id/barcode.png",
  barcodePngById
);

export default router;