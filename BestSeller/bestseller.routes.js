// routes/bestseller.routes.js
// mount: app.use("/api", router);

import { Router } from "express";
import {
  createBestseller,
  getAllBestsellers,
  getAllBestsellerIds,
  getBestsellerById,
  updateBestseller,
  deleteBestseller,
  deleteBestsellerByProductId,
  setBestsellerOrder, // ✅ NEW
} from "../BestSeller/BestSeller.Controller.js";

const router = Router();

// CREATE (idempotent recommended)
router.post("/bestseller", createBestseller);

// READ
router.get("/bestseller", getAllBestsellers);
router.get("/bestseller/ids", getAllBestsellerIds);

// ✅ ORDER (save selected order)
router.put("/bestseller/order", setBestsellerOrder);
router.post("/bestseller/order", setBestsellerOrder); // optional fallback

// READ/UPDATE/DELETE by bestseller doc _id
router.get("/bestseller/:id", getBestsellerById);
router.put("/bestseller/:id", updateBestseller);
router.delete("/bestseller/:id", deleteBestseller);

// DELETE by productId (used by UI)
router.delete("/bestseller/product/:productId", deleteBestsellerByProductId);

export default router;
