import express from "express";
import {
  createCollection,
  getAllCollections,
  getCollectionById,
  updateCollection,
  deleteCollection,
} from "../Collection/collectionController.js";

const router = express.Router();

/**
 * @route   POST /api/collections
 * @desc    Create a new collection
 * @access  Private (Admin)
 */
router.post("/", createCollection);

/**
 * @route   GET /api/collections
 * @desc    Get all collections
 * @access  Public
 */
router.get("/", getAllCollections);

/**
 * @route   GET /api/collections/:idOrSlug
 * @desc    Get a single collection by ID or slug
 * @access  Public
 */
router.get("/:idOrSlug", getCollectionById);

/**
 * @route   PUT /api/collections/:id
 * @desc    Update an existing collection
 * @access  Private (Admin)
 */
router.put("/:id", updateCollection);

/**
 * @route   DELETE /api/collections/:id
 * @desc    Delete a collection
 * @access  Private (Admin)
 */
router.delete("/:id", deleteCollection);

export default router;
