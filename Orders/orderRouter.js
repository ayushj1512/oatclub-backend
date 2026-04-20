import express from "express";

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
  getProductOrderCount,
  searchProductOrderNumbers,
  findOrdersByStateAndPincode,
  getDuplicateOrderAlerts,
  markDuplicateOrderAlertsController,
} from "./orderController.js";

import { getRefundPendingCandidates } from "./orderRefunds.controller.js";

import {
  getInvoicesByOrderNumbers,
  getInvoiceById,
  getInvoiceByOrderNumber,
} from "./order.invoice.controller.js";

import {
  getSalesReport,
  getRevenueReport,
  getSalesLedgerReport,
  downloadSalesLedgerCsv,
  getGSTReport,
} from "./orderAccountsController.js";

import {
  getProductSalesReport,
  getLowSellingProducts,
  getUnsoldProducts,
  getOrderBusinessOverview,
  getROASReport,
  getOperationsStatusReport,
  getFinalPayableByStatus,
} from "./orderReportsController.js";

import {
  getCustomerSupportOrders,
  getCustomerSupportOrderDetail,
} from "../Orders/customerSupportOrderController.js";

import {
  createRma,
  updateRma,
  getRmasByOrder,
  getRmaByNumber,
  getAllRmasAdmin,
} from "./orderRmaController.js";

import {
  getProductionQueue,
  getProductionSummary,
  markOrderShippedFromProduction,
  markAllPackedOrdersShipped,
  getProductionJobList,
  exportProductionJobListExcel,
  getProcessingOrderProductList,
} from "./order.production.controller.js";

import { bookWithShiprocket } from "../shiprocket/shipping.controller.js";

import {
  verifyWhatsappWebhook,
  whatsappConfirmOrderWebhook,
  whatsappCancelOrderWebhook,
} from "./order.whatsapp.webhook.js";

const router = express.Router();

/* Orders */
router.post("/", createOrder);
router.get("/", getAllOrders);

/* WhatsApp Webhooks */
router.get("/whatsapp/webhook", verifyWhatsappWebhook);
router.post("/whatsapp/webhook/order-confirm", whatsappConfirmOrderWebhook);
router.post("/whatsapp/webhook/order-cancel", whatsappCancelOrderWebhook);

/* Search / Lookup / Analytics */
router.get("/lookup", lookupOrdersByIdentity);
router.get("/product-order-count", getProductOrderCount);
router.get("/product-order-search", searchProductOrderNumbers);
router.get("/customer-support", getCustomerSupportOrders);
router.get("/customer-support/:id", getCustomerSupportOrderDetail);
router.get("/analytics/summary", getOrderAnalytics);
router.get("/duplicate-alerts", getDuplicateOrderAlerts);
router.post("/duplicate-alerts/mark", markDuplicateOrderAlertsController);
router.get("/location/search", findOrdersByStateAndPincode);

/* Refund / Escalation */
router.get("/refund-pending-candidates", getRefundPendingCandidates);

/* Accounts / Reports */
router.get("/accounts/sales-report", getSalesReport);
router.get("/accounts/gst-report", getGSTReport);
router.get("/accounts/sales-ledger", getSalesLedgerReport);
router.get("/accounts/sales-ledger/csv", downloadSalesLedgerCsv);
router.get("/accounts/sales-report/products", getProductSalesReport);
router.get("/accounts/sales-report/products/low-selling", getLowSellingProducts);
router.get("/accounts/sales-report/products/unsold", getUnsoldProducts);
router.get("/accounts/revenue-report", getRevenueReport);
router.get("/accounts/business-overview", getOrderBusinessOverview);
router.get("/reports/roas", getROASReport);
router.get("/reports/operations-status", getOperationsStatusReport);
router.get("/reports/final-payable-by-status", getFinalPayableByStatus);

/* Invoices */
router.post("/invoices", getInvoicesByOrderNumbers);
router.get("/by-number/:orderNumber/invoice", getInvoiceByOrderNumber);
router.get("/:id/invoice", getInvoiceById);

/* Production */
router.get("/production/summary", getProductionSummary);
router.get("/production/queue", getProductionQueue);
router.get("/production/jobs", getProductionJobList);
router.get("/production/jobs/export", exportProductionJobListExcel);
router.get("/production/processing-products", getProcessingOrderProductList);
router.post("/production/:id/shipped", markOrderShippedFromProduction);
router.patch("/production/packed/mark-all-shipped", markAllPackedOrdersShipped);

/* Customer / Order Lookups */
router.get("/customer/:customerId", getOrdersByCustomer);
router.get("/by-number/:orderNumber", getOrderByOrderNumber);

/* Actions */
router.post("/:id/shiprocket/book", adminBookShiprocketIfMissing);
router.post("/:id/ship", bookWithShiprocket);
router.post("/:id/cancel", cancelOrder);
router.post("/:orderId/duplicate-exchange", duplicateExchangeOrder);
router.post("/:id/confirm", confirmOrder);
router.post("/:id/split", splitOrderIntoShipments);

/* RMA */
router.get("/rma", getAllRmasAdmin);
router.post("/:id/rma", createRma);
router.get("/:id/rma", getRmasByOrder);
router.get("/:id/rma/:rmaNumber", getRmaByNumber);
router.patch("/:id/rma/:rmaNumber", updateRma);

/* Order by ID */
router.patch("/:id/status", updateOrderStatus);
router.patch("/:id/tracking", updateTracking);
router.patch("/:id/address", updateOrderAddress);
router.patch("/:id", updateOrder);
router.put("/:id", updateOrder);
router.get("/:id", getOrderById);

export default router;