import express from "express";

/* ---------------- PRODUCT CONTROLLER ---------------- */
import {
  createProduct,
  getAllProducts,
  getProductsByTag,
  getProductByIdOrSlug,
  getProductBySKU,
  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
  bulkImportProducts,
  updateVariantStock,
  incrementProductAnalytics,
  updateProductRatings,
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

// Products by tag(s)
router.get("/by-tag", getProductsByTag);

// Get all products (filters, pagination, search)
router.get("/", getAllProducts);

// Fetch by SKU (product or variant)
router.get("/sku/:sku", getProductBySKU);

// Product details by slug OR id
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

// Existing bulk operations
router.post("/bulk/delete", bulkDeleteProducts);
router.post("/bulk/import", bulkImportProducts);

/* ===========================================================
   🔐 ADMIN ROUTES (SINGLE PRODUCT OPS)
=========================================================== */

router.post("/:id/update-ratings", updateProductRatings);
router.patch("/:id/analytics", incrementProductAnalytics);
router.patch("/:id/variant-stock", updateVariantStock);

router.post("/", createProduct);
router.put("/:id", updateProduct);
router.delete("/:id", deleteProduct);

/* ===========================================================
   FALLBACK (Slug OR ID)
=========================================================== */

router.get("/:id", getProductByIdOrSlug);

export default router;
