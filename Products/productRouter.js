import express from "express";
import multer from "multer";

/* ---------------- PRODUCT CONTROLLER ---------------- */
import {
  createProduct,
  getAllProducts,
  getProductsByTag,
  getProductsByCategory,
  fetchProductsByCategory,
  getProductsByCollection,
  getProductsByIds,
  getProductsByCodes, // ✅ NEW
  getProductBySKU,
  getProductByCode,
  getProductByIdOrSlug,
  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
  bulkImportProducts,
  bulkUpdatePricing,
  bulkSyncCollectionOnProducts,
  updateProductStock, // ✅ NEW (simple stock endpoint)
  updateVariantStock,
  incrementProductAnalytics,
  updateProductRatings,
  updateProductFabrics,
  updateVariantPatternNumber,
} from "./productController.js";

/* ---------------- BULK CONTROLLER ---------------- */
import {
  bulkPreviewProducts,
  bulkCreateDraftProducts,
} from "./BulkproductController.js";

/* ---------------- SETUP ---------------- */
const router = express.Router();
const upload = multer({ dest: "uploads/csv" });

/* ===========================================================
   🔓 PUBLIC ROUTES (CUSTOMERS)
   (keep specific routes above generic ones)
=========================================================== */

// ✅ Products by tag(s)
router.get("/by-tag", getProductsByTag);

// ✅ Products by category (slug OR id OR name)
router.get("/by-category/:category", getProductsByCategory);

// ✅ Products by collection (slug OR id)
router.get("/by-collection/:collection", getProductsByCollection);

// ✅ Alternative fetch-by-category (param + query supported)
router.get("/fetch-by-category/:category", fetchProductsByCategory);
router.get("/fetch-by-category", fetchProductsByCategory);

// ✅ Products by multiple IDs (single fetch)
router.post("/by-ids", getProductsByIds);

// ✅ Products by multiple productCodes (single fetch)  ✅ NEW
// GET  /api/products/by-codes?codes=00229,00230
// POST /api/products/by-codes  body: { codes: ["00229","00230"] } OR { codes: "00229,00230" }
router.get("/by-codes", getProductsByCodes);
router.post("/by-codes", getProductsByCodes);

// ✅ Fetch by SKU (product or variant)
router.get("/sku/:sku", getProductBySKU);

// ✅ Fetch by productCode (IMPORTANT: must be above /:id fallback)
router.get("/code/:code", getProductByCode);

// ✅ Product details by slug OR id (explicit details route)
router.get("/details/:id", getProductByIdOrSlug);

// ✅ Get all products (filters, pagination, search)
router.get("/", getAllProducts);

/* ===========================================================
   🔐 ADMIN ROUTES (BULK)
=========================================================== */

// ✅ CSV PREVIEW (NO DB WRITE)
router.post("/bulk/preview", upload.single("file"), bulkPreviewProducts);

// ✅ CREATE DRAFT PRODUCTS (NO IMAGES)
router.post("/bulk/create-draft", bulkCreateDraftProducts);

// ✅ Existing bulk operations
router.post("/bulk/delete", bulkDeleteProducts);
router.post("/bulk/import", bulkImportProducts);
router.patch("/bulk/pricing", bulkUpdatePricing);

// ✅ Bulk sync collection ↔ products
router.patch("/bulk/collections/sync", bulkSyncCollectionOnProducts);

/* ===========================================================
   🔐 ADMIN ROUTES (SINGLE PRODUCT OPS)
=========================================================== */

router.post("/:id/update-ratings", updateProductRatings);
router.patch("/:id/analytics", incrementProductAnalytics);

// ✅ Inventory endpoints (2 only)
router.patch("/:id/stock", updateProductStock);           // ✅ SIMPLE only
router.patch("/:id/variant-stock", updateVariantStock);   // ✅ VARIABLE only

// ✅ Update fabrics + consumption (dedicated)
router.patch("/:id/fabrics", updateProductFabrics);

// ✅ Create product
router.post("/", createProduct);

// ✅ Update product
router.patch("/:id", updateProduct);
router.put("/:id", updateProduct);
router.patch("/:id/variant-pattern", updateVariantPatternNumber);

// ✅ Delete product
router.delete("/:id", deleteProduct);

/* ===========================================================
   FALLBACK (Slug OR ID) — MUST ALWAYS BE LAST
=========================================================== */

router.get("/:id", getProductByIdOrSlug);

export default router;
