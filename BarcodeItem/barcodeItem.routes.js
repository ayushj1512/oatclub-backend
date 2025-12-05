import { Router } from "express";
import {
  createBarcodeItem,
  listBarcodeItems,
  getBarcodeItemById,
  getBarcodeItemByBarcode,
  scanBarcode,
  updateBarcodeItem,
  deleteBarcodeItem,
  barcodePngById,
  generateBarcodePngNoSave
} from "../BarcodeItem/barcodeItem.controller.js";

const router = Router();

// Health (optional, but useful)
router.get("/health", (req, res) => res.json({ ok: true }));

// Create + list
router.post("/barcodes", createBarcodeItem);
router.get("/barcodes", listBarcodeItems);

// Scan (barcodeText) + fetch by exact barcode text
router.post("/barcodes/scan", scanBarcode);
router.get("/barcodes/by-barcode/:barcodeText", getBarcodeItemByBarcode);

// Generate PNG without saving in DB
router.get("/barcodes/generate.png", generateBarcodePngNoSave);

// CRUD by Mongo _id
router.get("/barcodes/:id", getBarcodeItemById);
router.patch("/barcodes/:id", updateBarcodeItem);
router.delete("/barcodes/:id", deleteBarcodeItem);

// Generate PNG for a saved item
router.get("/barcodes/:id/barcode.png", barcodePngById);

export default router;
