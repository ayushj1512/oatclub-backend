// routes/sizeChartRoutes.js
import express from "express";
import {
  createSizeChart,
  getAllSizeCharts,
  getSizeChartById,
  updateSizeChart,
  deleteSizeChart,
} from "./sizeChartController.js";

const router = express.Router();

/* ================= SIZE CHART ROUTES ================= */

router.post("/", createSizeChart);
router.get("/", getAllSizeCharts);
router.get("/:id", getSizeChartById);
router.put("/:id", updateSizeChart);
router.delete("/:id", deleteSizeChart);

export default router;
