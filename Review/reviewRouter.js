import express from "express";
import {
  // public/customer
  createReview,
  getAllReviews,
  getReviewById,
  updateReview,
  deleteReview,

  // admin
  adminGetReviews,
  adminBulkUpdateStatus,
  adminBulkDeleteReviews,
} from "./reviewController.js";

const router = express.Router();

/* -------------------------
   ✅ ADMIN routes (keep above "/:id")
-------------------------- */
router.get("/admin/list", adminGetReviews);
router.patch("/admin/bulk/status", adminBulkUpdateStatus);
router.post("/admin/bulk/delete", adminBulkDeleteReviews);

/* -------------------------
   ✅ PUBLIC routes
-------------------------- */
router.post("/", createReview);
router.get("/", getAllReviews);
router.get("/:id", getReviewById);
router.put("/:id", updateReview);
router.delete("/:id", deleteReview);

export default router;
