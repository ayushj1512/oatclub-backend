import express from "express";

import {
  createFabric,
  getFabrics,
  searchFabrics,
  getFabricOptions,
  getFabricStats,
  getLowStockFabrics,
  getFabricById,
  getFabricByCode,
  updateFabric,
  updateFabricStatus,
  updateFabricMovementStatus,
  updateFabricLowStockThreshold,
  updateAllFabricLowStockThresholds,
  refreshFabricLowStock,
  refreshAllFabricsLowStock,
  assignProductCodesToFabric,
  addAssociatedProductCodes,
  removeAssociatedProductCodes,
  deleteFabric,
  activateFabric,
  bulkUpdateFabrics,
} from "./fabric.controller.js";

const router = express.Router();

/* ============================================================
   CREATE + LIST
============================================================ */
router.post("/", createFabric);
router.get("/", getFabrics);

/* ============================================================
   STATIC ROUTES

   Important:
   Keep all static routes before /:id, otherwise Express may
   treat values like "search", "options" or "stats" as an ID.
============================================================ */
router.get("/search", searchFabrics);
router.get("/options", getFabricOptions);
router.get("/stats", getFabricStats);
router.get("/low-stock", getLowStockFabrics);
router.get("/code/:code", getFabricByCode);

/* ============================================================
   BULK ACTIONS
============================================================ */
router.patch("/bulk-update", bulkUpdateFabrics);

router.patch(
  "/low-stock/refresh-all",
  refreshAllFabricsLowStock
);

router.patch(
  "/low-stock/threshold-all",
  updateAllFabricLowStockThresholds
);

/* ============================================================
   SINGLE FABRIC
============================================================ */
router.get("/:id", getFabricById);

router.put("/:id", updateFabric);
router.patch("/:id", updateFabric);

router.patch(
  "/:id/status",
  updateFabricStatus
);

router.patch(
  "/:id/movement",
  updateFabricMovementStatus
);

router.patch(
  "/:id/low-stock-threshold",
  updateFabricLowStockThreshold
);

router.patch(
  "/:id/refresh-low-stock",
  refreshFabricLowStock
);

/* ============================================================
   PRODUCT ASSOCIATION
============================================================ */
router.patch(
  "/:id/assign-products",
  assignProductCodesToFabric
);

router.patch(
  "/:id/add-product-codes",
  addAssociatedProductCodes
);

router.patch(
  "/:id/remove-product-codes",
  removeAssociatedProductCodes
);

/* ============================================================
   ACTIVATE + DELETE
============================================================ */
router.patch(
  "/:id/activate",
  activateFabric
);

router.delete(
  "/:id",
  deleteFabric
);

export default router;