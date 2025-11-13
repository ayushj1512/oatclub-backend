import express from "express";
import {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  clearWishlist,
} from "../controllers/wishlistController.js";

const router = express.Router();

// Get wishlist for a customer
// GET /api/wishlist/:customerId
router.get("/:customerId", getWishlist);

// Add a product to wishlist
// POST /api/wishlist/:customerId/add
router.post("/:customerId/add", addToWishlist);

// Remove a product from wishlist
// POST /api/wishlist/:customerId/remove
router.post("/:customerId/remove", removeFromWishlist);

// Clear entire wishlist
// DELETE /api/wishlist/:customerId
router.delete("/:customerId", clearWishlist);

export default router;
