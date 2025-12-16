import express from "express";
import {
  createProduct,
  getAllProducts,
  getProductsByTag, // ✅ NEW
  getProductByIdOrSlug,
  getProductBySKU,
  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
  bulkImportProducts,
  updateVariantStock,
  incrementProductAnalytics,
  updateProductRatings,
} from "../controller/productController.js";

const router = express.Router();

/* ===========================================================
   🔓 PUBLIC ROUTES (Customers)
=========================================================== */

// ✅ Products by tag(s)
// Examples:
//   /api/products/by-tag?tag=sale
//   /api/products/by-tag?tags=sale,new-arrival&page=1&limit=20
router.get("/by-tag", getProductsByTag);

// Get all products (filters, pagination, search)
// NOTE: supports category/subcategory as slug OR ObjectId
router.get("/", getAllProducts);

// Warehouse/ops: fetch by SKU (product sku or variant sku)
router.get("/sku/:sku", getProductBySKU);

// Product details by slug OR id
router.get("/details/:id", getProductByIdOrSlug);

/* ===========================================================
   🔐 ADMIN ROUTES
   (Place BEFORE dynamic "/:id" route to avoid conflicts)
=========================================================== */

router.post("/bulk/delete", bulkDeleteProducts);
router.post("/bulk/import", bulkImportProducts);

router.post("/:id/update-ratings", updateProductRatings);
router.patch("/:id/analytics", incrementProductAnalytics);
router.patch("/:id/variant-stock", updateVariantStock);

router.post("/", createProduct);
router.put("/:id", updateProduct);
router.delete("/:id", deleteProduct);

/* ===========================================================
   FALLBACK: GET SINGLE PRODUCT BY SLUG or ID
=========================================================== */
router.get("/:id", getProductByIdOrSlug);

export default router;
