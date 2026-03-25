import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

import {
  createRemittance,
  getRemittances,
  getRemittanceById,
  updateRemittance,
  deleteRemittance,
  importRemittanceCsv,
  exportRemittanceCsv,
  exportRemittanceExcel,
  getPendingRemittances,
  getRemittanceSummary,
  exportPendingRemittancesCsv,
} from "./RemittanceController.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* upload setup                                                               */
/* -------------------------------------------------------------------------- */

const uploadDir = path.join(process.cwd(), "uploads", "remittance");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || ".csv");
    cb(null, `remittance-${Date.now()}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const ok =
    file.mimetype === "text/csv" ||
    file.mimetype === "application/vnd.ms-excel" ||
    /\.csv$/i.test(file.originalname || "");

  if (!ok) return cb(new Error("Only CSV file is allowed"));
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

/* -------------------------------------------------------------------------- */
/* routes                                                                     */
/* -------------------------------------------------------------------------- */

router.get("/summary", getRemittanceSummary);
router.get("/pending", getPendingRemittances);

router.get("/export/csv", exportRemittanceCsv);
router.get("/export/excel", exportRemittanceExcel);
router.get("/pending/export/csv", exportPendingRemittancesCsv);
router.post("/import/csv", upload.single("file"), importRemittanceCsv);

router.post("/", createRemittance);
router.get("/", getRemittances);
router.get("/:id", getRemittanceById);
router.put("/:id", updateRemittance);
router.delete("/:id", deleteRemittance);

export default router;