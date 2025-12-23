// AbandonedCart/AbandonedCartController.js
import express from "express";

import {
  upsertAbandonedCart,
  listAbandonedCarts,
  getAbandonedCart,
  markCartAbandoned,
  markCartRecovered,
  markRetargeted,
  deleteAbandonedCart,
} from "./AbandonedCartController.js";

const router = express.Router();

/**
 * Mount at:
 * app.use("/api/abandoned-carts", router)
 */

// Create / Update (idempotent)
router.post("/upsert", upsertAbandonedCart);

// Read
router.get("/", listAbandonedCarts);
router.get("/:id", getAbandonedCart);

// Lifecycle
router.patch("/:id/abandon", markCartAbandoned);
router.patch("/:id/recover", markCartRecovered);
router.patch("/:id/retarget", markRetargeted);

// Delete (admin only later)
router.delete("/:id", deleteAbandonedCart);

export default router;
