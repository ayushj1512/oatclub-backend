// routes/categoryRoutes.js
import express from "express";
import {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} from "../controller/categoryController.js";

const router = express.Router();

/* ============================================================
   CATEGORY ROUTES — ENTERPRISE READY
   BASE URL: /api/categories
   ============================================================ */

/**
 * @route   POST /api/categories
 * @desc    Create new category (supports parent, SEO, icons, etc.)
 * @access  Private/Admin
 */
router.post("/", createCategory);

/**
 * @route   GET /api/categories
 * @desc    Get all categories (supports search, filter, tree)
 * @query   ?search=shirt
 *          ?active=true
 *          ?featured=true
 *          ?parent=null
 * @access  Public
 */
router.get("/", getAllCategories);

/**
 * @route   GET /api/categories/:id
 * @desc    Get single category by ID (populates parent + attributes)
 * @access  Public
 */
router.get("/:id", getCategoryById);

/**
 * @route   PUT /api/categories/:id
 * @desc    Update category (auto slug, safe validation)
 * @access  Private/Admin
 */
router.put("/:id", updateCategory);

/**
 * @route   DELETE /api/categories/:id
 * @desc    Delete category (blocks delete if subcategories exist)
 * @access  Private/Admin
 */
router.delete("/:id", deleteCategory);

export default router;
