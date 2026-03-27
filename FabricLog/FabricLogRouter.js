import express from "express";
import {
  getFabricLogs,
  getFabricLogsByCode,
  getFabricLogById,
  createFabricStockLog,
} from "./FabricLogController.js";

const router = express.Router();

/* ============================================================
   FABRIC LOG ROUTES
============================================================ */

router.get("/", getFabricLogs);
router.get("/code/:code", getFabricLogsByCode);
router.get("/:id", getFabricLogById);
router.post("/", createFabricStockLog);

export default router;