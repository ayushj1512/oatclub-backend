import express from "express";
import {
  getMetaDashboardSummary,
  testMetaSpendRaw,
} from "./MetaAdsController.js";

const router = express.Router();

router.get("/dashboard-summary", getMetaDashboardSummary);
router.get("/test-spend-raw", testMetaSpendRaw);

export default router;