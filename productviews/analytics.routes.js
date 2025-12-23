import express from "express";
import { trackProductAnalytics } from "./analyticsController.js";

const router = express.Router();

/**
 * POST /api/analytics/product
 * body: {
 *   productId: ObjectId,
 *   event: "view" | "cart_add" | "wishlist_add" | "purchase" | "search"
 * }
 */
router.post("/product", trackProductAnalytics);

export default router;
