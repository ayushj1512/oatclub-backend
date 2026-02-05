import express from "express";
import {
  createHomeCollection,
  listHomeCollections,
  listActiveHomeCollections,
  getHomeCollectionById,
  getHomeCollectionBySlug,
  updateHomeCollection,
  toggleHomeCollectionActive,
  deleteHomeCollection,
  reorderHomeCollections,
  upsertHomeCollections,
} from "../controllers/homeCollectionController.js";

const router = express.Router();

/* ---------------- PUBLIC (frontend) ---------------- */
// Homepage collections (only active, ordered)
router.get("/public", listActiveHomeCollections);

// Get by slug (optional for frontend)
router.get("/public/slug/:slug", getHomeCollectionBySlug);

/* ---------------- ADMIN ---------------- */
// list + create
router.get("/", listHomeCollections);
router.post("/", createHomeCollection);

// bulk actions
router.patch("/reorder", reorderHomeCollections);
router.post("/upsert", upsertHomeCollections);

// by id
router.get("/:id", getHomeCollectionById);
router.patch("/:id", updateHomeCollection);
router.patch("/:id/toggle", toggleHomeCollectionActive);
router.delete("/:id", deleteHomeCollection);

export default router;
