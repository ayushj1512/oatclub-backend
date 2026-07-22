import express from "express";
import multer from "multer";

import {
  createProduct,
  getAllProducts,
  getProductCards,
  getAvailableForCollabProducts,
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
  getAllProductMedia,
  syncProductAssociationGroup,
  updateCollabReadyStatus,
   // NEW
  updateDispatchReadyStatus,
  previewBulkProductMetadata,
  confirmBulkProductMetadata,
} from "./productController.js";

import { searchProductsForCard } from "./product.search.controller.js";

import {
  getVendorSamplingProducts,
  updateVendorSamplingStatus,
  addVendorSamplingRemark,
  getVendorPatternProducts,
  updateVendorPatternStatus,
} from "./product.vendor.controller.js";

import {
  getInventoryAdminProducts,
  getInventoryAdminCategories,
  getSingleInventoryAdminProduct,
  updateSingleInventoryAdminProduct,
} from "./inventory.product.controller.js";

import {
  bulkPreviewProducts,
  bulkCreateDraftProducts,
} from "./BulkproductController.js";

import { protectVendor } from "../VendorUser/vendorAuth.js";

const router = express.Router();

const uploadCsv = multer({
  dest: "uploads/csv",
});

const uploadSwatches = multer({
  dest: "uploads/swatch",
});

/* =========================================================
   ADMIN INVENTORY
========================================================= */

router.get(
  "/admin/inventory/categories",
  getInventoryAdminCategories
);

router.get(
  "/admin/inventory/:id",
  getSingleInventoryAdminProduct
);

router.patch(
  "/admin/inventory/:id",
  updateSingleInventoryAdminProduct
);

router.get(
  "/admin/inventory",
  getInventoryAdminProducts
);

/* =========================================================
   VENDOR
========================================================= */

router.get(
  "/vendor-sampling",
  protectVendor,
  getVendorSamplingProducts
);

router.patch(
  "/vendor-sampling/:id/status",
  protectVendor,
  updateVendorSamplingStatus
);

router.patch(
  "/vendor-sampling/:id/remark",
  protectVendor,
  addVendorSamplingRemark
);

router.get(
  "/vendor-patterns",
  protectVendor,
  getVendorPatternProducts
);

router.patch(
  "/vendor-patterns/:id/status",
  protectVendor,
  updateVendorPatternStatus
);

/* =========================================================
   PRODUCT LISTING / SEARCH
========================================================= */

router.get("/cards", getProductCards);
router.get("/card-search", searchProductsForCard);

router.get(
  "/available-for-collab",
  getAvailableForCollabProducts
);

router.get("/by-tag", getProductsByTag);

router.get(
  "/by-category/:category",
  getProductsByCategory
);

router.get(
  "/by-collection/:collection",
  getProductsByCollection
);

router.get(
  "/fetch-by-category/:category",
  fetchProductsByCategory
);

router.get(
  "/fetch-by-category",
  fetchProductsByCategory
);

router.post("/by-ids", getProductsByIds);

router.get("/by-codes", getProductsByCodes);
router.post("/by-codes", getProductsByCodes);

router.get(
  "/selected-codes",
  getProductsBySelectedCodes
);

router.post(
  "/selected-codes",
  getProductsBySelectedCodes
);

router.get("/sku/:sku", getProductBySKU);
router.get("/code/:code", getProductByCode);

router.get(
  "/details/:id",
  getProductByIdOrSlug
);

router.get("/media/all", getAllProductMedia);

router.get("/", getAllProducts);

/* =========================================================
   BULK ACTIONS
========================================================= */

router.post(
  "/bulk/preview",
  uploadCsv.single("file"),
  bulkPreviewProducts
);

router.post(
  "/bulk/create-draft",
  bulkCreateDraftProducts
);

router.post(
  "/bulk/delete",
  bulkDeleteProducts
);

router.post(
  "/bulk/import",
  bulkImportProducts
);

router.patch(
  "/bulk/pricing",
  bulkUpdatePricing
);

router.patch(
  "/bulk/dispatch-ready",
  updateDispatchReadyStatus,
);

router.post(
  "/bulk/metadata/preview",
  previewBulkProductMetadata,
);

router.patch(
  "/bulk/metadata/confirm",
  confirmBulkProductMetadata,
);

router.patch(
  "/bulk/variant-stock/zero-all",
  zeroAllVariantStock
);

router.patch(
  "/bulk/collections/sync",
  bulkSyncCollectionOnProducts
);

router.patch(
  "/bulk/trending/by-codes",
  bulkMarkTrendingByCodes
);

router.patch(
  "/bulk/collab-ready",
  updateCollabReadyStatus
);

/* =========================================================
   CREATE PRODUCT
========================================================= */

router.post("/", createProduct);

/* =========================================================
   PRODUCT ACTIONS
========================================================= */

router.patch(
  "/primary-status",
  updatePrimaryProductStatus
);

router.patch(
  "/:id/association-group",
  syncProductAssociationGroup
);

router.post(
  "/:id/update-ratings",
  updateProductRatings
);

router.patch(
  "/:id/analytics",
  incrementProductAnalytics
);

router.patch(
  "/:id/stock",
  updateProductStock
);

router.patch(
  "/:id/variant-stock",
  updateVariantStock
);

router.patch(
  "/:id/fabrics",
  updateProductFabrics
);

router.patch(
  "/:id/variant-pattern",
  updateVariantPatternNumber
);

router.patch(
  "/:id/mark-pattern-ready",
  markPatternReady
);

router.patch(
  "/:id/best-seller",
  toggleBestSeller
);

router.patch(
  "/:id/trending",
  toggleTrending
);

router.patch(
  "/:id/collab-ready",
  updateCollabReadyStatus
);

router.patch(
  "/:id/dispatch-ready",
  updateDispatchReadyStatus,
);

router.patch(
  "/:id/primary-status",
  updatePrimaryProductStatus
);

router.patch(
  "/:id/colors",
  uploadSwatches.fields([
    {
      name: "swatchImages",
      maxCount: 50,
    },
  ]),
  updateProductColors
);

/* =========================================================
   CRUD / FALLBACK
   Dynamic routes must remain at the bottom
========================================================= */

router.patch("/:id", updateProduct);
router.put("/:id", updateProduct);
router.delete("/:id", deleteProduct);
router.get("/:id", getProductByIdOrSlug);

export default router;