import express from "express";
import {
  getCommerceManagerConfig,
  upsertCommerceManagerConfig,
  addCommerceManagerProductCodes,
  removeCommerceManagerProductCodes,
  clearCommerceManagerProductCodes,
  toggleCommerceManagerStatus,
} from "./CommerceManagerController.js";

const router = express.Router();

/* =========================================================
   COMMERCE MANAGER ROUTES
========================================================= */

/**
 * @route   GET /api/commerce-manager
 * @desc    Get commerce manager config
 * @access  Admin
 */
router.get("/", getCommerceManagerConfig);

/**
 * @route   PUT /api/commerce-manager
 * @desc    Create/update full commerce manager config
 * @access  Admin
 */
router.put("/", upsertCommerceManagerConfig);

/**
 * @route   POST /api/commerce-manager/product-codes
 * @desc    Add selected product codes
 * @access  Admin
 */
router.post("/product-codes", addCommerceManagerProductCodes);

/**
 * @route   DELETE /api/commerce-manager/product-codes
 * @desc    Remove selected product codes
 * @access  Admin
 */
router.delete("/product-codes", removeCommerceManagerProductCodes);

/**
 * @route   DELETE /api/commerce-manager/product-codes/all
 * @desc    Clear all selected product codes
 * @access  Admin
 */
router.delete("/product-codes/all", clearCommerceManagerProductCodes);

/**
 * @route   PATCH /api/commerce-manager/toggle
 * @desc    Activate/deactivate commerce manager selection
 * @access  Admin
 */
router.patch("/toggle", toggleCommerceManagerStatus);

export default router;