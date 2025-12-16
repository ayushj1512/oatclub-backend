// src/routes/reels/reel.controller.js
import { Router } from "express";
import {
  createReel,
  listReels,
  getReel,
  updateReel,
  toggleReelActive,
  deleteReel,
  trackReelEvent,
} from "./reel.controller.js";

const router = Router();

/**
 * Base: /api/reels
 *
 * Public (recommended):
 *  - GET /            -> list reels (supports filters)
 *  - GET /:idOrSlug   -> single reel
 *  - POST /:id/events -> analytics events
 *
 * Admin (protect with auth middleware in your app):
 *  - POST /           -> create
 *  - PATCH /:id       -> update
 *  - PATCH /:id/toggle-> toggle active
 *  - DELETE /:id      -> delete
 */

// LIST
router.get("/", listReels);

// GET ONE (by _id or slug)
router.get("/:idOrSlug", getReel);

// CREATE
router.post("/", createReel);

// UPDATE
router.patch("/:id", updateReel);

// TOGGLE ACTIVE
router.patch("/:id/toggle", toggleReelActive);

// DELETE
router.delete("/:id", deleteReel);

// EVENTS (views/clicks/likes/shares)
router.post("/:id/events", trackReelEvent);

export default router;
