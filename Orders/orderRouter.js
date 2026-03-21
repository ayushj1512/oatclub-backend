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

  // ✅ Support lookup by email/phone
  lookupOrdersByIdentity,
} from "./orderController.js";

/* ===========================
   ✅ INVOICE CONTROLLER
=========================== */
import {
  getInvoicesByOrderNumbers,
  getInvoiceById,
  getInvoiceByOrderNumber,
} from "./order.invoice.controller.js";

/* ===========================
   ✅ ACCOUNTS CONTROLLER
=========================== */
import {
  getSalesReport,
  getRevenueReport,
} from "./orderAccountsController.js";

/* ===========================
   ✅ PRODUCT SALES REPORT CONTROLLER
=========================== */
import {
  getProductSalesReport,
  getOrderBusinessOverview,
} from "./orderReportsController.js";

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
  getProductionJobList,
  exportProductionJobListExcel,
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

/* ============================================================
   ACCOUNTS
   ✅ KEEP THESE ABOVE "/:id"
============================================================ */

// Existing sales report
router.get("/accounts/sales-report", getSalesReport);

// ✅ New product-wise sales report
// query params supported:
// ?month=2026-03&page=1&limit=20&search=abc&sort=qty_desc
router.get("/accounts/sales-report/products", getProductSalesReport);

// ✅ New revenue report
router.get("/accounts/revenue-report", getRevenueReport);

// ✅ Business overview
router.get("/accounts/business-overview", getOrderBusinessOverview);

/* ============================================================
   SUPPORT / ANALYTICS / LOOKUPS
============================================================ */

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
   ✅ INVOICE ROUTES
   ⚠️ KEEP ABOVE "/by-number/:orderNumber" and "/:id"
============================================================ */

// Bulk invoice fetch by order numbers
// POST /api/orders/invoices
// body: { "orderNumbers": ["MIRAY-001056", "MIRAY-001057"] }
router.post("/invoices", getInvoicesByOrderNumbers);

// Single invoice by order number
// GET /api/orders/by-number/:orderNumber/invoice
router.get("/by-number/:orderNumber/invoice", getInvoiceByOrderNumber);

// Single invoice by order id
// GET /api/orders/:id/invoice
router.get("/:id/invoice", getInvoiceById);

/* ============================================================
   ✅ PRODUCTION ROUTES (CONFIRMED ONLY)
============================================================ */

// Existing production summary + queue
router.get("/production/summary", getProductionSummary);
router.get("/production/queue", getProductionQueue);

// ✅ Production job list from InventoryReservation
// logic:
// - reservation.status = pending
// - reservation.refType = order
// - joined order.isConfirmed = true
// query params:
// ?q=sku123&page=1&limit=50&sort=qty_desc&from=2026-03-01&to=2026-03-31
router.get("/production/jobs", getProductionJobList);

// ✅ Export production job list excel
router.get("/production/jobs/export", exportProductionJobListExcel);

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

// Lookup by orderNumber
// ⚠️ keep above "/:id"
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

export default router;