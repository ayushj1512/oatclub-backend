import express from "express";

import {
  createFabricPriceLog,
  getAllFabricPriceLogs,
  getFabricPriceLogById,
  updateFabricPriceLog,
  deleteFabricPriceLog,
  getLatestFabricPrice,
  getLatestFabricPriceByCode,
  getFabricPriceHistory,
  getCurrentFabricPriceList,
  getBulkLatestFabricPrices,
  getFabricPriceAnalytics,
  getFabricPriceTrend,
  getTopFabricPriceChanges,
  getFabricPriceSummaryByFabric,
} from "./FabricPriceLogController.js";

const router = express.Router();

/* ============================================================
   FABRIC PRICE LOG ROUTES
============================================================ */

// create
router.post("/", createFabricPriceLog);

// bulk latest prices
router.post("/bulk-latest", getBulkLatestFabricPrices);

// analytics
router.get("/analytics/overview", getFabricPriceAnalytics);
router.get("/analytics/trend", getFabricPriceTrend);
router.get("/analytics/top-changes", getTopFabricPriceChanges);
router.get("/analytics/by-fabric", getFabricPriceSummaryByFabric);

// current latest price list
router.get("/current", getCurrentFabricPriceList);

// latest price
router.get("/latest/fabric/:fabricId", getLatestFabricPrice);
router.get("/latest/code/:fabricCode", getLatestFabricPriceByCode);

// history
router.get("/history/:fabricId", getFabricPriceHistory);

// all logs
router.get("/", getAllFabricPriceLogs);

// single log
router.get("/:id", getFabricPriceLogById);

// update safe fields
router.patch("/:id", updateFabricPriceLog);

// delete
router.delete("/:id", deleteFabricPriceLog);

export default router;