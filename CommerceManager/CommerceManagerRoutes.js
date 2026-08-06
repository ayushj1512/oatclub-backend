import express from "express";

import {
  // Default / backward-compatible feed
  getCommerceManagerConfig,
  upsertCommerceManagerConfig,
  addCommerceManagerProductCodes,
  removeCommerceManagerProductCodes,
  clearCommerceManagerProductCodes,
  toggleCommerceManagerStatus,

  // Multiple feed management
  listCommerceManagerFeeds,
  getCommerceManagerFeed,
  createCommerceManagerFeed,
  updateCommerceManagerFeed,
  deleteCommerceManagerFeed,

  // Feed-specific product code actions
  addFeedProductCodes,
  removeFeedProductCodes,
  clearFeedProductCodes,

  // XML feed actions
  getCommerceManagerXmlFeed,
  getCommerceManagerXmlFeedBySlug,
  refreshCommerceManagerXmlFeed,
  getCommerceManagerXmlFeedStatus,
  clearCommerceManagerXmlCache,
} from "./CommerceManagerController.js";

const router = express.Router();

/* =========================================================
   PUBLIC XML FEEDS
========================================================= */

/**
 * Existing default feed
 *
 * GET /api/commerce-manager/xml
 */
router.get("/xml", getCommerceManagerXmlFeed);

/**
 * Dynamic feed by slug
 *
 * GET /api/commerce-manager/xml/trending-tops
 * GET /api/commerce-manager/xml/multiway-dresses
 */
router.get("/xml/:slug", getCommerceManagerXmlFeedBySlug);

/* =========================================================
   DEFAULT FEED
   Backward-compatible routes
========================================================= */

/**
 * Get default feed configuration
 *
 * GET /api/commerce-manager
 */
router.get("/", getCommerceManagerConfig);

/**
 * Update default feed configuration
 *
 * PUT /api/commerce-manager
 */
router.put("/", upsertCommerceManagerConfig);

/**
 * Add product codes to default feed
 *
 * POST /api/commerce-manager/product-codes
 */
router.post(
  "/product-codes",
  addCommerceManagerProductCodes,
);

/**
 * Remove selected product codes from default feed
 *
 * DELETE /api/commerce-manager/product-codes
 */
router.delete(
  "/product-codes",
  removeCommerceManagerProductCodes,
);

/**
 * Clear all product codes from default feed
 *
 * DELETE /api/commerce-manager/product-codes/all
 */
router.delete(
  "/product-codes/all",
  clearCommerceManagerProductCodes,
);

/**
 * Enable or disable default feed
 *
 * PATCH /api/commerce-manager/toggle
 */
router.patch(
  "/toggle",
  toggleCommerceManagerStatus,
);

/* =========================================================
   MULTIPLE COMMERCE FEEDS
========================================================= */

/**
 * List all feeds
 *
 * GET /api/commerce-manager/feeds
 * GET /api/commerce-manager/feeds?search=dresses
 * GET /api/commerce-manager/feeds?isActive=true
 */
router.get(
  "/feeds",
  listCommerceManagerFeeds,
);

/**
 * Create feed
 *
 * POST /api/commerce-manager/feeds
 */
router.post(
  "/feeds",
  createCommerceManagerFeed,
);

/**
 * Get a single feed by ID or slug
 *
 * GET /api/commerce-manager/feeds/:id
 */
router.get(
  "/feeds/:id",
  getCommerceManagerFeed,
);

/**
 * Update a feed by ID or slug
 *
 * PATCH /api/commerce-manager/feeds/:id
 */
router.patch(
  "/feeds/:id",
  updateCommerceManagerFeed,
);

/**
 * Delete a feed
 *
 * DELETE /api/commerce-manager/feeds/:id
 */
router.delete(
  "/feeds/:id",
  deleteCommerceManagerFeed,
);

/* =========================================================
   FEED-SPECIFIC PRODUCT CODES
========================================================= */

/**
 * Add product codes to a feed
 *
 * POST /api/commerce-manager/feeds/:id/product-codes
 */
router.post(
  "/feeds/:id/product-codes",
  addFeedProductCodes,
);

/**
 * Remove selected product codes from a feed
 *
 * DELETE /api/commerce-manager/feeds/:id/product-codes
 */
router.delete(
  "/feeds/:id/product-codes",
  removeFeedProductCodes,
);

/**
 * Clear all product codes from a feed
 *
 * DELETE /api/commerce-manager/feeds/:id/product-codes/all
 */
router.delete(
  "/feeds/:id/product-codes/all",
  clearFeedProductCodes,
);

/* =========================================================
   XML REFRESH, STATUS AND CACHE
========================================================= */

/**
 * Refresh default feed XML
 *
 * POST /api/commerce-manager/xml/refresh
 */
router.post(
  "/xml/refresh",
  refreshCommerceManagerXmlFeed,
);

/**
 * Refresh a specific feed XML
 *
 * POST /api/commerce-manager/feeds/:id/xml/refresh
 */
router.post(
  "/feeds/:id/xml/refresh",
  refreshCommerceManagerXmlFeed,
);

/**
 * Get default feed XML cache status
 *
 * GET /api/commerce-manager/xml/status
 */
router.get(
  "/xml/status",
  getCommerceManagerXmlFeedStatus,
);

/**
 * Get specific feed XML cache status
 *
 * GET /api/commerce-manager/feeds/:id/xml/status
 */
router.get(
  "/feeds/:id/xml/status",
  getCommerceManagerXmlFeedStatus,
);

/**
 * Clear all XML caches
 *
 * DELETE /api/commerce-manager/xml/cache
 */
router.delete(
  "/xml/cache",
  clearCommerceManagerXmlCache,
);

/**
 * Clear cache for one feed
 *
 * DELETE /api/commerce-manager/feeds/:id/xml/cache
 */
router.delete(
  "/feeds/:id/xml/cache",
  clearCommerceManagerXmlCache,
);

export default router;
