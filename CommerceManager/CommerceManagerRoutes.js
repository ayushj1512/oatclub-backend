import express from "express";
import {
  getCommerceManagerConfig,
  upsertCommerceManagerConfig,
  addCommerceManagerProductCodes,
  removeCommerceManagerProductCodes,
  clearCommerceManagerProductCodes,
  toggleCommerceManagerStatus,
  getCommerceManagerXmlFeed,
  refreshCommerceManagerXmlFeed,
  getCommerceManagerXmlFeedStatus,
} from "./CommerceManagerController.js";

const router = express.Router();

/* =========================================================
   COMMERCE MANAGER ROUTES
========================================================= */

router.get("/", getCommerceManagerConfig);
router.put("/", upsertCommerceManagerConfig);

router.post("/product-codes", addCommerceManagerProductCodes);
router.delete("/product-codes", removeCommerceManagerProductCodes);
router.delete("/product-codes/all", clearCommerceManagerProductCodes);

router.patch("/toggle", toggleCommerceManagerStatus);

/* XML FEED */
router.get("/xml", getCommerceManagerXmlFeed);
router.post("/xml/refresh", refreshCommerceManagerXmlFeed);
router.get("/xml/status", getCommerceManagerXmlFeedStatus);

export default router;4