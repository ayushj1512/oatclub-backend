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

  // ✅ NEW
  checkCustomerExists,

  // ✅ CART ADDS
  addCartAddByCustomerId,
  removeCartAddByCustomerId,
  mergeGuestCartAddsByCustomerId,

  // ✅ NEW: Banking / Payout
  addCustomerBankingDetails,

} from "../Customer/customerController.js";

const router = express.Router();

/**
 * ✅ Create Customer
 */
router.post("/", createCustomer);

/**
 * ✅ Check if customer exists (Public)
 */
router.get("/exists", checkCustomerExists);

/**
 * ✅ Get all customers (Admin)
 */
router.get("/", getAllCustomers);

/**
 * ✅ Find customer by customerId / firebaseUID
 */
router.get("/by-customer-id/:customerId", getCustomerByCustomerId);
router.get("/by-firebase/:firebaseUID", getCustomerByFirebaseUID);

/**
 * ---------------------------------------------------------
 * ✅ CART ADDS ROUTES
 * ---------------------------------------------------------
 */
router.post("/:id/cart-adds/add", addCartAddByCustomerId);
router.post("/:id/cart-adds/remove", removeCartAddByCustomerId);
router.post("/:id/cart-adds/merge", mergeGuestCartAddsByCustomerId);

/**
 * ---------------------------------------------------------
 * ✅ NEW: Payout / Banking Details Route
 * ---------------------------------------------------------
 * PATCH /api/customers/:id/payout-details
 */
router.patch("/:id/payout-details", addCustomerBankingDetails);

/**
 * ✅ Get customer by Mongo ID
 */
router.get("/:id", getCustomerById);

/**
 * ✅ Update customer by Mongo ID
 */
router.put("/:id", updateCustomer);

/**
 * ✅ Update analytics
 */
router.patch("/:id/analytics", updateCustomerAnalytics);

/**
 * ✅ Delete customer
 */
router.delete("/:id", deleteCustomer);

export default router;