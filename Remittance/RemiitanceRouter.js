import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

import {
  createRemittance,
  getRemittances,
  getRemittanceById,
  updateRemittance,
  deleteRemittance,
  importRemittanceCsv,
  importRemittanceReport,
  getRemittanceImportSources,
  exportRemittanceCsv,
  exportRemittanceExcel,
  getPendingRemittances,
  getRemittanceSummary,
  exportPendingRemittancesCsv,
} from "./RemittanceController.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* Upload setup                                                               */
/* -------------------------------------------------------------------------- */

const uploadDir = path.join(
  process.cwd(),
  "uploads",
  "remittance"
);

fs.mkdirSync(uploadDir, {
  recursive: true,
});

const allowedExtensions = new Set([
  ".csv",
  ".xls",
  ".xlsx",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },

  filename: (_req, file, cb) => {
    const extension = path
      .extname(file.originalname || "")
      .toLowerCase();

    cb(
      null,
      `remittance-${Date.now()}-${crypto.randomUUID()}${extension}`
    );
  },
});

const fileFilter = (
  _req,
  file,
  cb
) => {
  const extension = path
    .extname(file.originalname || "")
    .toLowerCase();

  if (
    !allowedExtensions.has(extension)
  ) {
    return cb(
      new Error(
        "Only CSV, XLS and XLSX reports are allowed"
      )
    );
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

/* -------------------------------------------------------------------------- */
/* Routes                                                                     */
/* -------------------------------------------------------------------------- */

router.get(
  "/summary",
  getRemittanceSummary
);

router.get(
  "/pending",
  getPendingRemittances
);

router.get(
  "/import/sources",
  getRemittanceImportSources
);

router.get(
  "/export/csv",
  exportRemittanceCsv
);

router.get(
  "/export/excel",
  exportRemittanceExcel
);

router.get(
  "/pending/export/csv",
  exportPendingRemittancesCsv
);

/*
 * Unified provider import:
 * source = delhivery | shiprocket | razorpay
 */
router.post(
  "/import",
  upload.single("file"),
  importRemittanceReport
);

/*
 * Keep old CSV import for compatibility.
 */
router.post(
  "/import/csv",
  upload.single("file"),
  importRemittanceCsv
);

/*
 * Manual remittance entry.
 */
router.post(
  "/",
  createRemittance
);

router.get(
  "/",
  getRemittances
);

router.get(
  "/:id",
  getRemittanceById
);

router.put(
  "/:id",
  updateRemittance
);

router.delete(
  "/:id",
  deleteRemittance
);

export default router;
