import express from "express";
import {
  createBlog,
  getAllBlogs,
  getBlogByIdOrSlug,
  updateBlog,
  deleteBlog,
} from "../controller/blogController.js";

const router = express.Router();

/**
 * @route   POST /api/blogs
 * @desc    Create a new blog
 * @access  Private (admin only - add auth middleware later)
 */
router.post("/", createBlog);

/**
 * @route   GET /api/blogs
 * @desc    Get all blogs (supports ?published=true/false)
 * @access  Public
 */
router.get("/", getAllBlogs);

/**
 * @route   GET /api/blogs/:idOrSlug
 * @desc    Get a single blog by ID or slug
 * @access  Public
 */
router.get("/:idOrSlug", getBlogByIdOrSlug);

/**
 * @route   PUT /api/blogs/:id
 * @desc    Update a blog
 * @access  Private (admin only)
 */
router.put("/:id", updateBlog);

/**
 * @route   DELETE /api/blogs/:id
 * @desc    Delete a blog
 * @access  Private (admin only)
 */
router.delete("/:id", deleteBlog);

export default router;
