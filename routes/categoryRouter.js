import express from "express";
import {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} from "../controller/categoryController.js";

const router = express.Router();

/**
 * @route   POST /api/categories
 * @desc    Create a new category
 * @access  Private (admin)
 */
router.post("/", createCategory);

/**
 * @route   GET /api/categories
 * @desc    Get all categories
 * @access  Public
 */
router.get("/", getAllCategories);

/**
 * @route   GET /api/categories/:id
 * @desc    Get a single category by ID
 * @access  Public
 */
router.get("/:id", getCategoryById);

/**
 * @route   PUT /api/categories/:id
 * @desc    Update a category
 * @access  Private (admin)
 */
router.put("/:id", updateCategory);

/**
 * @route   DELETE /api/categories/:id
 * @desc    Delete a category
 * @access  Private (admin)
 */
router.delete("/:id", deleteCategory);

export default router;
