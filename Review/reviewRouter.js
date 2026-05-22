// reviewRoutes.js
import express from "express";
import {
  // public/customer
  createReview,
  createProductRating,
  getAllReviews,
  getReviewById,
  updateReview,
  deleteReview,
  getReviewsByProductCode,
  getRatingSummaryByProductCode,

  // order review link
  getOrderReviewData,
  submitOrderReviews,

  // admin
  adminGetReviews,
  adminBulkUpdateStatus,
  adminBulkDeleteReviews,
} from "./reviewController.js";

import { upload } from "../config/cloudinary.js";

const router = express.Router();

/* -------------------------
   ✅ ADMIN routes
   keep above "/:id"
-------------------------- */
router.get("/admin/list", adminGetReviews);
router.patch("/admin/bulk/status", adminBulkUpdateStatus);
router.post("/admin/bulk/delete", adminBulkDeleteReviews);

/* -------------------------
   ✅ ORDER REVIEW LINK routes
   keep above "/:id"
-------------------------- */
router.get("/order/:orderNumber", getOrderReviewData);
router.post("/order/:orderNumber", upload.any(), submitOrderReviews);

/* -------------------------
   ✅ PUBLIC routes
-------------------------- */

// Customer review/customer required
router.post("/", upload.array("images", 5), createReview);

// Rating-only/customer optional
router.post("/rating", upload.array("images", 5), createProductRating);

router.get("/", getAllReviews);

// By productCode
router.get("/product-code/:productCode", getReviewsByProductCode);

// Summary
router.get(
  "/product-code/:productCode/summary",
  getRatingSummaryByProductCode
);

router.get("/:id", getReviewById);
router.put("/:id", upload.array("images", 5), updateReview);
router.delete("/:id", deleteReview);

export default router;