import express from "express";
import {
  getPublicMarquee,
  createMarqueeItem,
  updateMarqueeItem,
  deleteMarqueeItem,
} from "./marquee.controller.js";

const router = express.Router();

/* =========================================
   PUBLIC ROUTE
   ========================================= */

// GET active marquee items
// GET /api/public/marquee
router.get("/public/marquee", getPublicMarquee);


/* =========================================
   ADMIN ROUTES
   ========================================= */

// Create marquee item
// POST /api/admin/marquee
router.post("/admin/marquee", createMarqueeItem);

// Update marquee item
// PATCH /api/admin/marquee/:id
router.patch("/admin/marquee/:id", updateMarqueeItem);

// Delete marquee item
// DELETE /api/admin/marquee/:id
router.delete("/admin/marquee/:id", deleteMarqueeItem);

export default router;