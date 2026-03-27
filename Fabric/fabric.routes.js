import express from "express";
import {
  createFabric,
  getFabrics,
  getFabricOptions,
  getFabricStats,
  getFabricById,
  getFabricByCode,
  updateFabric,
  updateFabricStatus,
  updateFabricMovementStatus,
  addAssociatedProductCodes,
  removeAssociatedProductCodes,
  deleteFabric,
  activateFabric,
  bulkUpdateFabrics,
} from "./fabric.controller.js";




const router = express.Router();

/* ============================================================
   FABRIC ADMIN ROUTES
============================================================ */

/**
 * @route   POST /api/fabrics
 * @desc    Create a new fabric
 * @access  Admin
 */
router.post("/", createFabric);

/**
 * @route   GET /api/fabrics
 * @desc    Get all fabrics with search, filters, pagination
 * @access  Admin
 */
router.get("/", getFabrics);

/**
 * @route   GET /api/fabrics/options
 * @desc    Get fabric dropdown/options list
 * @access  Admin
 */
router.get("/options", getFabricOptions);

/**
 * @route   GET /api/fabrics/stats
 * @desc    Get fabric stats summary
 * @access  Admin
 */
router.get("/stats", getFabricStats);

/**
 * @route   GET /api/fabrics/code/:code
 * @desc    Get single fabric by fabric code
 * @access  Admin
 */
router.get("/code/:code", getFabricByCode);

/**
 * @route   GET /api/fabrics/:id
 * @desc    Get single fabric by ID
 * @access  Admin
 */
router.get("/:id", getFabricById);

/**
 * @route   PUT /api/fabrics/:id
 * @desc    Update full fabric details
 * @access  Admin
 */
router.put("/:id", updateFabric);

/**
 * @route   PATCH /api/fabrics/:id/status
 * @desc    Update fabric active/inactive/discontinued status
 * @access  Admin
 */
router.patch("/:id/status", updateFabricStatus);

/**
 * @route   PATCH /api/fabrics/:id/movement
 * @desc    Update fabric movement status
 * @access  Admin / System
 */
router.patch("/:id/movement", updateFabricMovementStatus);

/**
 * @route   PATCH /api/fabrics/:id/add-product-codes
 * @desc    Add associated product codes to fabric
 * @access  Admin
 */
router.patch("/:id/add-product-codes", addAssociatedProductCodes);

/**
 * @route   PATCH /api/fabrics/:id/remove-product-codes
 * @desc    Remove associated product codes from fabric
 * @access  Admin
 */
router.patch("/:id/remove-product-codes", removeAssociatedProductCodes);

/**
 * @route   PATCH /api/fabrics/bulk-update
 * @desc    Bulk update multiple fabrics
 * @access  Admin
 */
router.patch("/bulk-update", bulkUpdateFabrics);

/**
 * @route   PATCH /api/fabrics/:id/activate
 * @desc    Activate fabric again
 * @access  Admin
 */
router.patch("/:id/activate", activateFabric);

/**
 * @route   DELETE /api/fabrics/:id
 * @desc    Soft delete fabric
 * @access  Admin
 */
router.delete("/:id", deleteFabric);

export default router;