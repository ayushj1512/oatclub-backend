import express from "express";

import {
  addProductToOrder,
  adjustOrderFinalPayable,
  adminBookDelhiveryIfMissing,
  adminBookShiprocketIfMissing,
  applyCouponAfterOrderPlaced,
  assignCourierToPackedOrder,
  cancelOrder,
  changeOrderItemSize,
  confirmOrder,
  createOrder,
  duplicateExchangeOrder,
  findOrdersByStateAndPincode,
  getAdvancedFilteredOrders,
  getAllOrders,
  getDelhiveryRateForOrder,
  getDuplicateOrderAlerts,
  getOrderAnalytics,
  getOrderById,
  getOrderByOrderNumber,
  getOrderConfirmationDetails,
  getOrdersByCustomer,
  getOrdersDashboard,
  getPackedOrdersForShipping,
  getProductOrderCount,
  getShiprocketRatesForOrder,
  lookupOrdersByIdentity,
  markCodOrderAsPaid,
  markDuplicateOrderAlertsController,
  markOrderAsInfluencer,
  removeProductFromOrder,
  searchProductOrderNumbers,
  sendBulkOrderPaymentRecoveryEmails,
  sendOrderPaymentRecoveryEmail,
  splitOrder,
  toggleTestingOrder,
  updateOrder,
  updateOrderAddress,
  updateOrderPaymentStatus,
  updateOrderStatus,
  updateTracking,
  repairSplitOrderToOriginal,
  updateRtoReceivedStatus,

} from "./orderController.js";

import {
  getEligibleUnrefundedOrders,
  getRefundPendingCandidates,
} from "./orderRefunds.controller.js";

import {
  getInvoiceById,
  getInvoiceByOrderNumber,
  getInvoicesByOrderNumbers,
  getRecentInvoices,
} from "./order.invoice.controller.js";

import {
  downloadSalesLedgerCsv,
  getGSTReport,
  getRevenueReport,
  getSalesLedgerReport,
  getSalesReport,
} from "./orderAccountsController.js";

import {
  getCancellationAnalyticsReport,
  getFinalPayableByStatus,
  getLowSellingProducts,
  getOperationsStatusReport,
  getOrderBusinessOverview,
  getProductSalesReport,
  getROASReport,
  getUnsoldProducts,
} from "./orderReportsController.js";

import {
  getCustomerSupportOrderDetail,
  getCustomerSupportOrders,
} from "./customerSupportOrderController.js";

import {
  createRma,
  getAllRmasAdmin,
  getRmaByNumber,
  getRmasByOrder,
  updateRma,
  refundRmaToCredit,
} from "./orderRmaController.js";

import { getRmaReasonsGroupedByProductCode } from "./order.rma.controller.js";

import {
  exportProductionJobListExcel,
  getProcessingOrderProductList,
  getProductionJobList,
  getProductionQueue,
  getProductionSummary,
  markAllPackedOrdersShipped,
  markOrderShippedFromProduction,
} from "./order.production.controller.js";

import { bookWithShiprocket } from "../shiprocket/shipping.controller.js";

import {
  verifyWhatsappWebhook,
  whatsappCancelOrderWebhook,
  whatsappConfirmOrderWebhook,
} from "./order.whatsapp.webhook.js";

import { sendReviewWhatsappManually } from "./orders.review.controller.js";

import {
  exportVendorProductionJobs,
  getVendorProductionJobs,
} from "./order.vendor.production.controller.js";

import { protectVendor } from "../VendorUser/vendorAuth.js";

const router = express.Router();

/* ============================================================
   ORDERS ROOT
============================================================ */

router.post("/", createOrder);
router.get("/", getAllOrders);

router.get(
  "/advanced-filter",
  getAdvancedFilteredOrders,
);

/* ============================================================
   DASHBOARD
   Keep before dynamic /:id routes
============================================================ */

router.get("/dashboard", getOrdersDashboard);

/* ============================================================
   WHATSAPP WEBHOOKS
============================================================ */

router.get("/whatsapp/webhook", verifyWhatsappWebhook);

router.post("/whatsapp/webhook/order-confirm", whatsappConfirmOrderWebhook);

router.post("/whatsapp/webhook/order-cancel", whatsappCancelOrderWebhook);

/* ============================================================
   SEARCH / LOOKUP / ANALYTICS
============================================================ */

router.get("/lookup", lookupOrdersByIdentity);

router.get("/product-order-count", getProductOrderCount);
router.get("/product-order-search", searchProductOrderNumbers);

router.get("/customer-support", getCustomerSupportOrders);
router.get("/customer-support/:id", getCustomerSupportOrderDetail);

router.get("/analytics/summary", getOrderAnalytics);

router.get("/duplicate-alerts", getDuplicateOrderAlerts);

router.post("/duplicate-alerts/mark", markDuplicateOrderAlertsController);

router.get("/location/search", findOrdersByStateAndPincode);

/* ============================================================
   CONFIRMED / NOT CONFIRMED LISTS
   Keep before /:id
============================================================ */

router.get("/confirmed", (req, res) => {
  req.query.confirmFilter = "confirmed";
  return getAllOrders(req, res);
});

router.get("/not-confirmed", (req, res) => {
  req.query.confirmFilter = "not_confirmed";
  return getAllOrders(req, res);
});

/* ============================================================
   REFUND / ESCALATION
============================================================ */

router.get("/refund-pending-candidates", getRefundPendingCandidates);

router.get("/eligible-unrefunded", getEligibleUnrefundedOrders);

/* ============================================================
   POST ORDER COUPON / PAYABLE ADJUSTMENTS
============================================================ */

router.post("/:id/apply-coupon-after-order", applyCouponAfterOrderPlaced);

router.patch("/:id/adjust-final-payable", adjustOrderFinalPayable);

/* ============================================================
   ACCOUNTS / REPORTS
============================================================ */

router.get("/accounts/sales-report", getSalesReport);
router.get("/accounts/gst-report", getGSTReport);

router.get("/accounts/sales-ledger", getSalesLedgerReport);

router.get("/accounts/sales-ledger/csv", downloadSalesLedgerCsv);

router.get("/accounts/sales-report/products", getProductSalesReport);

router.get(
  "/accounts/sales-report/products/low-selling",
  getLowSellingProducts,
);

router.get("/accounts/sales-report/products/unsold", getUnsoldProducts);

router.get("/accounts/revenue-report", getRevenueReport);

router.get("/accounts/business-overview", getOrderBusinessOverview);

router.get("/reports/roas", getROASReport);

router.get("/reports/operations-status", getOperationsStatusReport);

router.get("/reports/final-payable-by-status", getFinalPayableByStatus);

router.get("/reports/cancellations", getCancellationAnalyticsReport);

/* ============================================================
   INVOICES
   Static invoice routes must stay before /:id/invoice
============================================================ */

/**
 * Bulk invoices through request body:
 *
 * POST /api/orders/invoices
 *
 * {
 *   "orderNumbers": ["000001", "000002"]
 * }
 */
router.post("/invoices", getInvoicesByOrderNumbers);

/**
 * Bulk invoices through query:
 *
 * GET /api/orders/invoices?orderNumbers=000001,000002
 */
router.get("/invoices", getInvoicesByOrderNumbers);

/**
 * Filtered recent invoices:
 *
 * GET /api/orders/invoices/recent
 * GET /api/orders/invoices/recent?limit=50
 * GET /api/orders/invoices/recent?fulfillmentStatus=packed
 */
router.get("/invoices/recent", getRecentInvoices);

/**
 * Single invoice using order number:
 *
 * GET /api/orders/by-number/000001/invoice
 */
router.get("/by-number/:orderNumber/invoice", getInvoiceByOrderNumber);

/**
 * Single invoice using MongoDB order ID:
 *
 * GET /api/orders/:id/invoice
 */
router.get("/:id/invoice", getInvoiceById);

/* ============================================================
   VENDOR PRODUCTION
============================================================ */

router.get("/vendor/production/jobs", protectVendor, getVendorProductionJobs);

router.get(
  "/vendor/production/jobs/export",
  protectVendor,
  exportVendorProductionJobs,
);

/* ============================================================
   ADMIN PRODUCTION
   Duplicate production route block removed
============================================================ */

router.get("/production/summary", getProductionSummary);

router.get("/production/queue", getProductionQueue);

router.get("/production/jobs", getProductionJobList);

router.get("/production/jobs/export", exportProductionJobListExcel);

router.get("/production/processing-products", getProcessingOrderProductList);

router.patch("/production/packed/mark-all-shipped", markAllPackedOrdersShipped);

router.post("/production/:id/shipped", markOrderShippedFromProduction);

/* ============================================================
   CUSTOMER / ORDER NUMBER LOOKUPS
============================================================ */

router.get("/customer/:customerId", getOrdersByCustomer);

router.get("/by-number/:orderNumber", getOrderByOrderNumber);

/* ============================================================
   RMA STATIC ROUTES
   Keep before /:id/rma
============================================================ */

router.get("/rma", getAllRmasAdmin);

router.get("/rma/grouped-by-product-code", getRmaReasonsGroupedByProductCode);

/* ============================================================
   ORDER ACTIONS
============================================================ */

router.post(
  "/:orderIdOrNumber/review-whatsapp/send",
  sendReviewWhatsappManually,
);

router.post("/:id/shiprocket/book", adminBookShiprocketIfMissing);

router.get(
  "/:id/delhivery/rate",
  getDelhiveryRateForOrder,
);

router.post("/:id/delhivery/book", adminBookDelhiveryIfMissing);


router.post("/:id/ship", bookWithShiprocket);

router.get("/shipping/packed", getPackedOrdersForShipping);

router.patch("/:id/courier", assignCourierToPackedOrder);

router.get(
  "/:id/shiprocket/rates",
  getShiprocketRatesForOrder,
);

router.post("/:id/cancel", cancelOrder);

router.post("/:orderId/duplicate-exchange", duplicateExchangeOrder);

router.post("/:id/confirm", confirmOrder);

router.post("/:orderId/split", splitOrder);

router.patch("/:id/toggle-testing", toggleTestingOrder);

// router.post("/:id/split", splitOrderIntoShipments);

router.patch("/:id/influencer-order", markOrderAsInfluencer);

/* ============================================================
   ORDER RMA BY ID
============================================================ */

router.post("/:id/rma", createRma);

router.get("/:id/rma", getRmasByOrder);

router.get("/:id/rma/:rmaNumber", getRmaByNumber);

router.patch("/:id/rma/:rmaNumber", updateRma);

/* ============================================================
   ORDER UPDATE ROUTES
============================================================ */

router.patch("/:id/status", updateOrderStatus);

router.patch("/:id/payment-status", updateOrderPaymentStatus);

router.patch("/:id/tracking", updateTracking);

router.patch("/:id/address", updateOrderAddress);

router.get("/:id/confirmation-details", getOrderConfirmationDetails);

router.patch("/:id", updateOrder);

router.put("/:id", updateOrder);

router.patch("/:id/mark-cod-paid", markCodOrderAsPaid);

/* ============================================================
   ORDER BY ID
   Always keep last
============================================================ */

router.get("/:id", getOrderById);

/* ============================================================
   ORDER ITEM EDITING
============================================================ */

router.post("/:id/items", addProductToOrder);

router.delete("/:id/items/:lineId", removeProductFromOrder);

router.patch("/:id/items/:lineId/size", changeOrderItemSize);

router.post(
  "/send-payment-recovery-emails",
  sendBulkOrderPaymentRecoveryEmails,
);

router.post(
  "/:id/send-payment-recovery-email",
  sendOrderPaymentRecoveryEmail,
);

router.post(
  "/repair-split-original",
  repairSplitOrderToOriginal,
);

router.post(
  "/:id/rma/:rmaNumber/refund-credit",
  refundRmaToCredit
);

router.patch(
  "/:id/rto-received",
  updateRtoReceivedStatus
);


export default router;
