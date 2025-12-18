import express from "express";
import { incrementProductView } from "./analyticsController.js";

const router = express.Router();

/**
 * POST /api/analytics/product-view
 * body: { productId }
 */
router.post("/product-view", incrementProductView);

export default router;
