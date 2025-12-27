import express from "express";
import {
  createFabric,
  getFabrics,
  getFabricById,
  updateFabric,
  deleteFabric,
  updateFabricMovementStatus,
} from "./fabric.controller.js";

const router = express.Router();

/* ============================================================
   FABRIC ROUTES
============================================================ */

/**
 * @route   POST /api/fabrics
 * @desc    Create a new fabric
 * @access  Admin
 */
router.post("/", createFabric);

/**
 * @route   GET /api/fabrics
 * @desc    Get all fabrics (search + filters)
 * @access  Admin
 */
router.get("/", getFabrics);

/**
 * @route   GET /api/fabrics/:id
 * @desc    Get single fabric by ID
 * @access  Admin
 */
router.get("/:id", getFabricById);

/**
 * @route   PUT /api/fabrics/:id
 * @desc    Update fabric details
 * @access  Admin
 */
router.put("/:id", updateFabric);

/**
 * @route   DELETE /api/fabrics/:id
 * @desc    Soft delete fabric
 * @access  Admin
 */
router.delete("/:id", deleteFabric);

/**
 * @route   PATCH /api/fabrics/:id/movement
 * @desc    Update fabric movement status (system controlled)
 * @access  System / Admin
 */
router.patch("/:id/movement", updateFabricMovementStatus);

export default router;
