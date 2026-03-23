// routes/orderRoutes.js
import express from "express";

/* ===========================
   ORDER CONTROLLER
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
  lookupOrdersByIdentity,
} from "./orderController.js";

/* ===========================
   INVOICE CONTROLLER
=========================== */
import {
  getInvoicesByOrderNumbers,
  getInvoiceById,
  getInvoiceByOrderNumber,
} from "./order.invoice.controller.js";

/* ===========================
   ACCOUNTS CONTROLLER
=========================== */
import {
  getSalesReport,
  getRevenueReport,
} from "./orderAccountsController.js";

/* ===========================
   REPORTS CONTROLLER
=========================== */
import {
  getProductSalesReport,
  getOrderBusinessOverview,
  getROASReport,
  getOperationsStatusReport,
} from "./orderReportsController.js";

/* ===========================
   CUSTOMER SUPPORT
=========================== */
import {
  getCustomerSupportOrders,
  getCustomerSupportOrderDetail,
} from "../Orders/customerSupportOrderController.js";

/* ===========================
   RMA CONTROLLER
=========================== */
import {
  createRma,
  updateRma,
  getRmasByOrder,
  getRmaByNumber,
  getAllRmasAdmin,
} from "./orderRmaController.js";

/* ===========================
   PRODUCTION CONTROLLER
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

/* ===========================
   ORDERS
=========================== */
router.post("/", createOrder);
router.get("/", getAllOrders);

/* ===========================
   ACCOUNTS / REPORTS
=========================== */
router.get("/accounts/sales-report", getSalesReport);
router.get("/accounts/sales-report/products", getProductSalesReport);
router.get("/accounts/revenue-report", getRevenueReport);
router.get("/accounts/business-overview", getOrderBusinessOverview);

router.get("/reports/roas", getROASReport);
router.get("/reports/operations-status", getOperationsStatusReport);

/* ===========================
   SUPPORT / ANALYTICS / LOOKUPS
=========================== */
router.get("/lookup", lookupOrdersByIdentity);
router.get("/customer-support", getCustomerSupportOrders);
router.get("/customer-support/:id", getCustomerSupportOrderDetail);
router.get("/analytics/summary", getOrderAnalytics);

/* ===========================
   INVOICES
=========================== */
router.post("/invoices", getInvoicesByOrderNumbers);
router.get("/by-number/:orderNumber/invoice", getInvoiceByOrderNumber);
router.get("/:id/invoice", getInvoiceById);

/* ===========================
   PRODUCTION
=========================== */
router.get("/production/summary", getProductionSummary);
router.get("/production/queue", getProductionQueue);
router.get("/production/jobs", getProductionJobList);
router.get("/production/jobs/export", exportProductionJobListExcel);
router.post("/production/:id/shipped", markOrderShippedFromProduction);
router.patch("/production/packed/mark-all-shipped", markAllPackedOrdersShipped);

/* ===========================
   CUSTOMER / LOOKUPS
=========================== */
router.get("/customer/:customerId", getOrdersByCustomer);
router.get("/by-number/:orderNumber", getOrderByOrderNumber);

/* ===========================
   SHIPROCKET ADMIN
=========================== */
router.post("/:id/shiprocket/book", adminBookShiprocketIfMissing);

/* ===========================
   ORDER ACTIONS
=========================== */
router.post("/:id/ship", bookWithShiprocket);
router.post("/:id/cancel", cancelOrder);
router.post("/:orderId/duplicate-exchange", duplicateExchangeOrder);
router.post("/:id/confirm", confirmOrder);

/* ===========================
   SPLIT ORDER
=========================== */
router.post("/:id/split", splitOrderIntoShipments);

/* ===========================
   RMA
=========================== */
router.get("/rma", getAllRmasAdmin);
router.post("/:id/rma", createRma);
router.get("/:id/rma", getRmasByOrder);
router.get("/:id/rma/:rmaNumber", getRmaByNumber);
router.patch("/:id/rma/:rmaNumber", updateRma);

/* ===========================
   ORDER BY ID
=========================== */
router.patch("/:id", updateOrder);
router.put("/:id", updateOrder);
router.get("/:id", getOrderById);
router.patch("/:id/status", updateOrderStatus);
router.patch("/:id/tracking", updateTracking);
router.patch("/:id/address", updateOrderAddress);

export default router;