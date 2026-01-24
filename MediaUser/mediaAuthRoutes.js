// MediaUser/mediaAuthRoutes.js
import express from "express";
import { register, login, logout, me } from "./mediaAuthController.js";
import { requireAuth } from "./authMiddleware.js";

const router = express.Router();

/**
 * Base mount: /media-user
 * Endpoints:
 * POST /media-user/register
 * POST /media-user/login
 * POST /media-user/logout
 * GET  /media-user/me   (protected)
 */

router.post("/register", register);
router.post("/login", login);
router.post("/logout", requireAuth, logout);

// current logged-in user
router.get("/me", requireAuth, me);

export default router;
