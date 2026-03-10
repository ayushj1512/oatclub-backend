// routes/orderRoutes.js
import express from "express";

/* ===========================
   ORDER CONTROLLER (Orders)
=========================== */
import {
  createOrder,
  getAllOrders,
  getOrderById,
  getOrdersByCustomer,
  updateOrder,
  updateOrderStatus,
  updateTracking,
  getOrderAnalytics,
  getOrderByOrderNumber,
  cancelOrder,
  confirmOrder,
  adminBookShiprocketIfMissing,
  updateOrderAddress,
  splitOrderIntoShipments,
  duplicateExchangeOrder,

  // ✅ NEW: lookup by email/phone (support)
  lookupOrdersByIdentity,
} from "./orderController.js";
import { getSalesReport } from "./orderAccountsController.js";

/* ===========================
   ✅ CUSTOMER SUPPORT CONTROLLER
=========================== */
import {
  getCustomerSupportOrders,
  getCustomerSupportOrderDetail,
} from "../Orders/customerSupportOrderController.js";

/* ===========================
   RMA CONTROLLER (RMA Only)
=========================== */
import {
  createRma,
  updateRma,
  getRmasByOrder,
  getRmaByNumber,
  getAllRmasAdmin,
} from "./orderRmaController.js";

/* ===========================
   ✅ PRODUCTION CONTROLLER
=========================== */
import {
  getProductionQueue,
  getProductionSummary,
  markOrderShippedFromProduction,
  markAllPackedOrdersShipped,
} from "./order.production.controller.js";

/* ===========================
   SHIPROCKET
=========================== */
import { bookWithShiprocket } from "../shiprocket/shipping.controller.js";

const router = express.Router();

/* ============================================================
   ORDERS (Collection)
============================================================ */

// Create order
router.post("/", createOrder);

// Admin: all orders (supports query filters)
router.get("/", getAllOrders);

// ✅ Support lookup: find orders by email/phone
// GET /api/orders/lookup?email=a@b.com OR ?phone=99999...
router.get("/lookup", lookupOrdersByIdentity);

// ✅ Customer support lightweight list
// GET /api/orders/customer-support
router.get("/customer-support", getCustomerSupportOrders);

// ✅ Customer support single detail
// GET /api/orders/customer-support/:id
router.get("/customer-support/:id", getCustomerSupportOrderDetail);

// Analytics summary
router.get("/analytics/summary", getOrderAnalytics);

/* ============================================================
   ✅ PRODUCTION ROUTES (CONFIRMED ONLY)
============================================================ */

router.get("/production/summary", getProductionSummary);
router.get("/production/queue", getProductionQueue);

// ✅ Single order -> shipped
router.post("/production/:id/shipped", markOrderShippedFromProduction);

// ✅ Bulk packed -> shipped
// supports optional query params like:
// /api/orders/production/packed/mark-all-shipped?q=abc
router.patch("/production/packed/mark-all-shipped", markAllPackedOrdersShipped);

/* ============================================================
   CUSTOMER / LOOKUPS
============================================================ */

// Customer orders
router.get("/customer/:customerId", getOrdersByCustomer);

// Lookup by orderNumber (⚠️ keep above "/:id")
router.get("/by-number/:orderNumber", getOrderByOrderNumber);

/* ============================================================
   ✅ SHIPROCKET ADMIN TRIGGERS
============================================================ */

// ✅ Single: Book Shiprocket only if missing
router.post("/:id/shiprocket/book", adminBookShiprocketIfMissing);

/* ============================================================
   ORDER ACTIONS (Ship / Cancel / Confirm / Exchange)
============================================================ */

// Book shipment (existing route)
router.post("/:id/ship", bookWithShiprocket);

// Cancel order
router.post("/:id/cancel", cancelOrder);

// Duplicate Exchange Order
router.post("/:orderId/duplicate-exchange", duplicateExchangeOrder);

// Confirm order (Admin / COD confirm)
router.post("/:id/confirm", confirmOrder);

/* ============================================================
   SPLIT ORDER
   ✅ Fix: remove extra "/orders" prefix (already under /api/orders)
============================================================ */

router.post("/:id/split", splitOrderIntoShipments);

/* ============================================================
   RMA (Return / Exchange)
============================================================ */

// Admin: Get all RMAs (global list)
router.get("/rma", getAllRmasAdmin);

// Create RMA (return / exchange)
router.post("/:id/rma", createRma);

// Get all RMAs of an order
router.get("/:id/rma", getRmasByOrder);

// Get single RMA by number
router.get("/:id/rma/:rmaNumber", getRmaByNumber);

// Admin update RMA
router.patch("/:id/rma/:rmaNumber", updateRma);

/* ============================================================
   ORDER BY ID (KEEP AT BOTTOM)
============================================================ */

// Update full order (PATCH preferred)
router.patch("/:id", updateOrder);

// (optional legacy) PUT update
router.put("/:id", updateOrder);

// Read
router.get("/:id", getOrderById);

// Status / tracking
router.patch("/:id/status", updateOrderStatus);
router.patch("/:id/tracking", updateTracking);

// Address update
router.patch("/:id/address", updateOrderAddress);

/* ============================================================
   ACCOUNTS
============================================================ */

router.get("/accounts/sales-report", getSalesReport);

export default router;