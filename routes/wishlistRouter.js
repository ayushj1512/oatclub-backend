import express from "express";
import {
  getWishlistByFirebaseUID,
  addToWishlist,
  removeFromWishlist,
  clearWishlist,
} from "../controller/wishlistController.js";

const router = express.Router();

router.get("/firebase/:firebaseUID", getWishlistByFirebaseUID);
router.post("/firebase/:firebaseUID/add", addToWishlist);
router.post("/firebase/:firebaseUID/remove", removeFromWishlist);
router.delete("/firebase/:firebaseUID", clearWishlist);

export default router;
