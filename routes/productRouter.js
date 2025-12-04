import express from "express";
import {
  createProduct,
  getAllProducts,
  getProductByIdOrSlug,
  getProductBySKU,            // ✅ NEW
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

// Get all products (filters, pagination, search)
router.get("/", getAllProducts);

// ✅ Warehouse/ops: fetch by SKU (product sku or variant sku)
router.get("/sku/:sku", getProductBySKU);

// Product details by slug OR id
router.get("/details/:id", getProductByIdOrSlug);

/* ===========================================================
   🔐 ADMIN ROUTES
   (Place BEFORE dynamic "/:id" routes to avoid conflicts)
=========================================================== */

// Bulk delete products
router.post("/bulk/delete", bulkDeleteProducts);

// Bulk import WooCommerce/CSV products
router.post("/bulk/import", bulkImportProducts);

// Manually update product ratings
router.post("/:id/update-ratings", updateProductRatings);

// Update analytics (views, wishlistCount, etc.)
router.patch("/:id/analytics", incrementProductAnalytics);

// Update variant stock
router.patch("/:id/variant-stock", updateVariantStock);

/* ===========================================================
   ADMIN CRUD ROUTES (AFTER ABOVE)
=========================================================== */

// Create product
router.post("/", createProduct);

// Update product
router.put("/:id", updateProduct);

// Delete product
router.delete("/:id", deleteProduct);

/* ===========================================================
   FALLBACK: GET SINGLE PRODUCT BY SLUG or ID
=========================================================== */
router.get("/:id", getProductByIdOrSlug);

export default router;
