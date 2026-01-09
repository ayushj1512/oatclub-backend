import express from "express";

/* ---------------- PRODUCT CONTROLLER ---------------- */
import {
  createProduct,
  getAllProducts,
  getProductsByTag,
  getProductsByCategory,   // ✅ ADD THIS
  getProductByIdOrSlug,
  getProductBySKU,

  // ✅ NEW: multiple ids fetch
  getProductsByIds,

  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
  bulkImportProducts,
  updateVariantStock,
  incrementProductAnalytics,
  updateProductRatings,
  bulkUpdatePricing
} from "./productController.js";

/* ---------------- BULK CONTROLLER ---------------- */
import {
  bulkPreviewProducts,
  bulkCreateDraftProducts,
} from "./BulkproductController.js";

/* ---------------- MIDDLEWARE ---------------- */
import multer from "multer";

const upload = multer({ dest: "uploads/csv" });
const router = express.Router();

/* ===========================================================
   🔓 PUBLIC ROUTES (CUSTOMERS)
=========================================================== */

// ✅ Products by tag(s)
router.get("/by-tag", getProductsByTag);

// ✅ Products by category (slug OR id OR name)
router.get("/by-category/:category", getProductsByCategory);

// ✅ ✅ NEW: Products by multiple IDs (single fetch)
router.post("/by-ids", getProductsByIds);

// ✅ Get all products (filters, pagination, search)
router.get("/", getAllProducts);

// ✅ Fetch by SKU (product or variant)
router.get("/sku/:sku", getProductBySKU);

// ✅ Product details by slug OR id
router.get("/details/:id", getProductByIdOrSlug);

/* ===========================================================
   🔐 ADMIN ROUTES (BULK — MUST BE FIRST)
=========================================================== */

// ✅ CSV PREVIEW (NO DB WRITE)
router.post(
  "/bulk/preview",
  upload.single("file"), // CSV file
  bulkPreviewProducts
);

// ✅ CREATE DRAFT PRODUCTS (NO IMAGES)
router.post(
  "/bulk/create-draft",
  bulkCreateDraftProducts
);

// ✅ Existing bulk operations
router.post("/bulk/delete", bulkDeleteProducts);
router.post("/bulk/import", bulkImportProducts);
router.patch("/bulk/pricing", bulkUpdatePricing); // ✅ better here (bulk route)

/* ===========================================================
   🔐 ADMIN ROUTES (SINGLE PRODUCT OPS)
=========================================================== */

router.post("/:id/update-ratings", updateProductRatings);
router.patch("/:id/analytics", incrementProductAnalytics);
router.patch("/:id/variant-stock", updateVariantStock);

router.post("/", createProduct);

router.patch("/:id", updateProduct); // ✅ partial update
router.put("/:id", updateProduct);   // optional full update
router.delete("/:id", deleteProduct);

/* ===========================================================
   FALLBACK (Slug OR ID) — MUST ALWAYS BE LAST
=========================================================== */

router.get("/:id", getProductByIdOrSlug);

export default router;
