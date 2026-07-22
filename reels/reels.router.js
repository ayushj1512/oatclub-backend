// src/routes/reels/reel.routes.js
import { Router } from "express";

import {
  createReel,
  listReels,
  getReel,
  updateReel,
  toggleReelActive,
  deleteReel,
  trackReelEvent,
  reorderReels,
} from "./reel.controller.js";

const router = Router();

/* =========================================================
   COLLECTION ROUTES
========================================================= */

router.get("/", listReels);
router.post("/", createReel);

/*
 * Must stay before PATCH /:id.
 * Otherwise "reorder" is treated as a reel ID.
 */
router.patch("/reorder", reorderReels);

/* =========================================================
   SINGLE REEL ROUTES
========================================================= */

router.get("/:idOrSlug", getReel);
router.patch("/:id/toggle", toggleReelActive);
router.post("/:id/events", trackReelEvent);
router.patch("/:id", updateReel);
router.delete("/:id", deleteReel);

export default router;