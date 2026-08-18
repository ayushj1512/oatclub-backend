import express from "express";

import {
  getCommerceManagerConfig,
  upsertCommerceManagerConfig,
  addCommerceManagerProductCodes,
  removeCommerceManagerProductCodes,
  clearCommerceManagerProductCodes,
  toggleCommerceManagerStatus,

  listCommerceManagerFeeds,
  getCommerceManagerFeed,
  createCommerceManagerFeed,
  updateCommerceManagerFeed,
  deleteCommerceManagerFeed,

  addFeedProductCodes,
  removeFeedProductCodes,
  clearFeedProductCodes,

  getCommerceManagerXmlFeed,
  getCommerceManagerXmlFeedBySlug,
  refreshCommerceManagerXmlFeed,
  getCommerceManagerXmlFeedStatus,
  clearCommerceManagerXmlCache,
} from "./CommerceManagerController.js";

import {
  getGoogleMerchantXmlFeed,
  getGoogleMerchantXmlFeedBySlug,
} from "./GoogleMerchantController.js";

const router = express.Router();

/* =========================================================
   PUBLIC XML FEEDS
========================================================= */

// Meta
router.get("/xml", getCommerceManagerXmlFeed);
router.get("/xml/:slug", getCommerceManagerXmlFeedBySlug);

// Google Merchant Center
router.get("/google/xml", getGoogleMerchantXmlFeed);
router.get("/google/xml/:slug", getGoogleMerchantXmlFeedBySlug);

/* =========================================================
   DEFAULT FEED
========================================================= */

router.get("/", getCommerceManagerConfig);
router.put("/", upsertCommerceManagerConfig);

router.post(
  "/product-codes",
  addCommerceManagerProductCodes,
);

router.delete(
  "/product-codes",
  removeCommerceManagerProductCodes,
);

router.delete(
  "/product-codes/all",
  clearCommerceManagerProductCodes,
);

router.patch(
  "/toggle",
  toggleCommerceManagerStatus,
);

/* =========================================================
   FEEDS
========================================================= */

router.get(
  "/feeds",
  listCommerceManagerFeeds,
);

router.post(
  "/feeds",
  createCommerceManagerFeed,
);

router.get(
  "/feeds/:id",
  getCommerceManagerFeed,
);

router.patch(
  "/feeds/:id",
  updateCommerceManagerFeed,
);

router.delete(
  "/feeds/:id",
  deleteCommerceManagerFeed,
);

/* =========================================================
   FEED PRODUCT CODES
========================================================= */

router.post(
  "/feeds/:id/product-codes",
  addFeedProductCodes,
);

router.delete(
  "/feeds/:id/product-codes",
  removeFeedProductCodes,
);

router.delete(
  "/feeds/:id/product-codes/all",
  clearFeedProductCodes,
);

/* =========================================================
   XML MANAGEMENT
========================================================= */

router.post(
  "/xml/refresh",
  refreshCommerceManagerXmlFeed,
);

router.get(
  "/xml/status",
  getCommerceManagerXmlFeedStatus,
);

router.delete(
  "/xml/cache",
  clearCommerceManagerXmlCache,
);

router.post(
  "/feeds/:id/xml/refresh",
  refreshCommerceManagerXmlFeed,
);

router.get(
  "/feeds/:id/xml/status",
  getCommerceManagerXmlFeedStatus,
);

router.delete(
  "/feeds/:id/xml/cache",
  clearCommerceManagerXmlCache,
);

export default router;
