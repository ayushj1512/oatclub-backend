import express from "express";
import multer from "multer";

/* ---------------- PRODUCT CONTROLLERS ---------------- */
import {
  createProduct,
  getAllProducts,
  getProductCards,
  getProductsByTag,
  getProductsByCategory,
  fetchProductsByCategory,
  getProductsByCollection,
  getProductsByIds,
  getProductsByCodes,
  getProductsBySelectedCodes,
  getProductBySKU,
  getProductByCode,
  getProductByIdOrSlug,
  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
  bulkImportProducts,
  bulkUpdatePricing,
  bulkSyncCollectionOnProducts,
  updateProductStock,
  updateVariantStock,
  incrementProductAnalytics,
  updateProductRatings,
  updateProductFabrics,
  updateVariantPatternNumber,
  updateProductColors,
  toggleBestSeller,
  toggleTrending,
  bulkMarkTrendingByCodes,
  markPatternReady,
  zeroAllVariantStock,
  updatePrimaryProductStatus,
} from "./productController.js";

import { searchProductsForCard } from "./product.search.controller.js";

/* ---------------- INVENTORY CONTROLLERS ---------------- */
import {
  getInventoryAdminProducts,
  getInventoryAdminCategories,
  getSingleInventoryAdminProduct,
  updateSingleInventoryAdminProduct,
} from "./inventory.product.controller.js";

/* ---------------- BULK CONTROLLERS ---------------- */
import {
  bulkPreviewProducts,
  bulkCreateDraftProducts,
} from "./BulkproductController.js";

/* ---------------- SETUP ---------------- */
const router = express.Router();
const uploadCsv = multer({ dest: "uploads/csv" });
const uploadSwatches = multer({ dest: "uploads/swatch" });

/* =========================================================
   PUBLIC + SHARED ROUTES
========================================================= */

// inventory admin
router.get("/admin/inventory", getInventoryAdminProducts);
router.get("/admin/inventory/categories", getInventoryAdminCategories);
router.get("/admin/inventory/:id", getSingleInventoryAdminProduct);
router.patch("/admin/inventory/:id", updateSingleInventoryAdminProduct);

// product listing / search
router.get("/cards", getProductCards);
router.get("/card-search", searchProductsForCard);

router.get("/by-tag", getProductsByTag);
router.get("/by-category/:category", getProductsByCategory);
router.get("/by-collection/:collection", getProductsByCollection);

router.get("/fetch-by-category/:category", fetchProductsByCategory);
router.get("/fetch-by-category", fetchProductsByCategory);

router.post("/by-ids", getProductsByIds);
router.get("/by-codes", getProductsByCodes);
router.post("/by-codes", getProductsByCodes);

// new dedicated route for commerce manager selected codes
router.get("/selected-codes", getProductsBySelectedCodes);
router.post("/selected-codes", getProductsBySelectedCodes);

router.get("/sku/:sku", getProductBySKU);
router.get("/code/:code", getProductByCode);
router.get("/details/:id", getProductByIdOrSlug);

router.get("/", getAllProducts);

/* =========================================================
   BULK ROUTES
========================================================= */

router.post("/bulk/preview", uploadCsv.single("file"), bulkPreviewProducts);
router.post("/bulk/create-draft", bulkCreateDraftProducts);
router.post("/bulk/delete", bulkDeleteProducts);
router.post("/bulk/import", bulkImportProducts);

router.patch("/bulk/pricing", bulkUpdatePricing);
router.patch("/bulk/variant-stock/zero-all", zeroAllVariantStock);
router.patch("/bulk/collections/sync", bulkSyncCollectionOnProducts);
router.patch("/bulk/trending/by-codes", bulkMarkTrendingByCodes);

/* =========================================================
   SINGLE PRODUCT ROUTES
========================================================= */

router.post("/:id/update-ratings", updateProductRatings);
router.patch("/:id/analytics", incrementProductAnalytics);

router.patch("/:id/stock", updateProductStock);
router.patch("/:id/variant-stock", updateVariantStock);
router.patch("/:id/fabrics", updateProductFabrics);
router.patch("/:id/variant-pattern", updateVariantPatternNumber);

router.patch("/:id/mark-pattern-ready", markPatternReady);
router.patch("/:id/best-seller", toggleBestSeller);
router.patch("/:id/trending", toggleTrending);
router.patch("/:id/primary-status", updatePrimaryProductStatus);

router.patch(
  "/:id/colors",
  uploadSwatches.fields([{ name: "swatchImages", maxCount: 50 }]),
  updateProductColors
);

router.post("/", createProduct);
router.patch("/:id", updateProduct);
router.put("/:id", updateProduct);
router.delete("/:id", deleteProduct);

/* =========================================================
   FALLBACK — KEEP LAST
========================================================= */

router.get("/:id", getProductByIdOrSlug);

export default router;