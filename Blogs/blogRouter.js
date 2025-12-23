// routes/blogRouter.js
import express from "express";
import {
  createBlog,
  getAllBlogs,
  getBlogByIdOrSlug,
  updateBlog,
  deleteBlog,
} from "../Blogs/blogController.js";

const router = express.Router();

/**
 * PUBLIC
 * GET /api/blogs
 * Supports: ?published=true/false&q=&page=&limit=&category=&sort=
 */
router.get("/", getAllBlogs);

/**
 * PUBLIC
 * GET /api/blogs/:idOrSlug
 */
router.get("/:idOrSlug", getBlogByIdOrSlug);

/**
 * ADMIN (add auth later)
 * POST /api/blogs
 */
router.post("/", createBlog);

/**
 * ADMIN (add auth later)
 * PUT /api/blogs/:id
 */
router.put("/:id", updateBlog);

/**
 * ADMIN (add auth later)
 * DELETE /api/blogs/:id
 */
router.delete("/:id", deleteBlog);

export default router;
