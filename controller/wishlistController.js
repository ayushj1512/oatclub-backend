import express from "express";
import {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  clearWishlist,
} from "../controllers/wishlistController.js";

const router = express.Router();

router.get("/:customerId", getWishlist);
router.post("/:customerId/add", addToWishlist);
router.post("/:customerId/remove", removeFromWishlist);
router.delete("/:customerId", clearWishlist);

export default router;
