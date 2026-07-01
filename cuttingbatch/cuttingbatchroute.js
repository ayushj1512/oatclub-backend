import express from "express";

import {
  generateCuttingBatch,
  getCuttingBatches,
  getCuttingBatchById,
} from "./cuttingbatchcontroller.js";

const router = express.Router();

router.post("/", generateCuttingBatch);
router.get("/", getCuttingBatches);
router.get("/:id", getCuttingBatchById);

export default router;