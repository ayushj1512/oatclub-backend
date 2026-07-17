import express from "express";

import {
  generateCuttingBatch,
  getCuttingBatches,
  getCuttingBatchById,
} from "./cuttingbatchcontroller.js";

import {
  generateVendorCuttingBatch,
  getVendorCuttingBatches,
  getVendorCuttingBatchById,
} from "./cuttingbatch.vendor.controller.js";

import { protectVendor } from "../VendorUser/vendorAuth.js";

const router = express.Router();

/* =========================================================
   VENDOR CUTTING BATCHES
========================================================= */

router.get(
  "/vendor",
  protectVendor,
  getVendorCuttingBatches
);

router.post(
  "/vendor",
  protectVendor,
  generateVendorCuttingBatch
);

router.get(
  "/vendor/:id",
  protectVendor,
  getVendorCuttingBatchById
);

/* =========================================================
   ADMIN CUTTING BATCHES
========================================================= */

router.post("/", generateCuttingBatch);
router.get("/", getCuttingBatches);
router.get("/:id", getCuttingBatchById);

export default router;