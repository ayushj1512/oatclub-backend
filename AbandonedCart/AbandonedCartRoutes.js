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
} from "./AbandonedCartController.js"; // ✅ if controllers are exported from AbandonedCart/AbandonedCart.js

const router = express.Router();

/**
 * Base mount suggestion:
 * app.use("/api/abandoned-carts", router)
 */

// Create/Update (idempotent-ish)
router.post("/upsert", upsertAbandonedCart);

// Read
router.get("/", listAbandonedCarts);
router.get("/:id", getAbandonedCart);

// Lifecycle
router.patch("/:id/abandon", markCartAbandoned);
router.patch("/:id/recover", markCartRecovered);
router.patch("/:id/retargeted", markRetargeted);

// Delete
router.delete("/:id", deleteAbandonedCart);

export default router;
