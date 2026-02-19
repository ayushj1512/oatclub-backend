// reviewRoutes.js
import express from "express";
import {
  // public/customer
  createReview,
  createProductRating,              // ✅ NEW
  getAllReviews,
  getReviewById,
  updateReview,
  deleteReview,
  getReviewsByProductCode,
  getRatingSummaryByProductCode,    // ✅ NEW

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

// Customer review (customer required)
router.post("/", createReview);

// Rating-only / customer optional
router.post("/rating", createProductRating); // ✅ NEW

router.get("/", getAllReviews);

// ✅ By productCode (keep above "/:id")
router.get("/product-code/:productCode", getReviewsByProductCode);

// ✅ Summary (keep above "/:id")
router.get("/product-code/:productCode/summary", getRatingSummaryByProductCode); // ✅ NEW

router.get("/:id", getReviewById);
router.put("/:id", updateReview);
router.delete("/:id", deleteReview);

export default router;
