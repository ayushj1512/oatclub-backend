import express from "express";
import {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  updateCustomerAnalytics,
  deleteCustomer,
  getCustomerByCustomerId,
  getCustomerByFirebaseUID,

  // ✅ Exists
  checkCustomerExists,

  // ✅ Analytics
  syncCustomerAnalytics,
  syncAllCustomerAnalytics,
  getCustomerAnalyticsSummary,

  // ✅ Cart Adds
  addCartAddByCustomerId,
  removeCartAddByCustomerId,
  mergeGuestCartAddsByCustomerId,

  // ✅ Banking / Payout
  addCustomerBankingDetails,
} from "../Customer/customerController.js";

const router = express.Router();

/**
 * ✅ Create Customer
 */
router.post("/", createCustomer);

/**
 * ✅ Check if customer exists
 */
router.get("/exists", checkCustomerExists);

/**
 * ✅ Customer analytics summary
 * GET /api/customers/analytics/summary
 */
router.get("/analytics/summary", getCustomerAnalyticsSummary);

/**
 * ✅ Sync all customer analytics
 * PATCH /api/customers/analytics/sync-all
 */
router.patch("/analytics/sync-all", syncAllCustomerAnalytics);

/**
 * ✅ Get all customers
 */
router.get("/", getAllCustomers);

/**
 * ✅ Find customer by customerId / firebaseUID
 */
router.get("/by-customer-id/:customerId", getCustomerByCustomerId);
router.get("/by-firebase/:firebaseUID", getCustomerByFirebaseUID);

/**
 * ---------------------------------------------------------
 * ✅ Cart Adds Routes
 * ---------------------------------------------------------
 */
router.post("/:id/cart-adds/add", addCartAddByCustomerId);
router.post("/:id/cart-adds/remove", removeCartAddByCustomerId);
router.post("/:id/cart-adds/merge", mergeGuestCartAddsByCustomerId);

/**
 * ---------------------------------------------------------
 * ✅ Payout / Banking Details
 * ---------------------------------------------------------
 */
router.patch("/:id/payout-details", addCustomerBankingDetails);

/**
 * ✅ Sync single customer analytics from orders
 * PATCH /api/customers/:id/analytics/sync
 */
router.patch("/:id/analytics/sync", syncCustomerAnalytics);

/**
 * ✅ Update manual analytics fields
 */
router.patch("/:id/analytics", updateCustomerAnalytics);

/**
 * ✅ Get customer by Mongo ID
 */
router.get("/:id", getCustomerById);

/**
 * ✅ Update customer by Mongo ID
 */
router.put("/:id", updateCustomer);

/**
 * ✅ Delete customer
 */
router.delete("/:id", deleteCustomer);

export default router;