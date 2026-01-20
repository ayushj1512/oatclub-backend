// routes/bestseller.routes.js
// Hook this into your app: app.use("/api", bestsellerRoutes);

import { Router } from "express";

// ✅ Your controller path (as you shared)
import {
  createBestseller,
  getAllBestsellers,
  getAllBestsellerIds,
  getBestsellerById,
  updateBestseller,
  deleteBestseller,
  deleteBestsellerByProductId,
} from "../BestSeller/BestSeller.Controller.js"; // adjust ONLY if routes folder level differs

const router = Router();

// CREATE
router.post("/bestseller", createBestseller);

// READ
router.get("/bestseller", getAllBestsellers);

// READ (special) -> ONLY product IDs ✅
router.get("/bestseller/ids", getAllBestsellerIds);

// READ one (by bestseller doc _id)
router.get("/bestseller/:id", getBestsellerById);

// UPDATE (by bestseller doc _id)
router.put("/bestseller/:id", updateBestseller);

// DELETE (by bestseller doc _id)
router.delete("/bestseller/:id", deleteBestseller);

// DELETE (special) by productId
router.delete("/bestseller/product/:productId", deleteBestsellerByProductId);

export default router;
