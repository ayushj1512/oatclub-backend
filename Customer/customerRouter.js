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

  // ✅ CART ADDS (NEW)
  addCartAddByCustomerId,
  removeCartAddByCustomerId,
  mergeGuestCartAddsByCustomerId,
} from "../Customer/customerController.js";

const router = express.Router();

/**
 * ✅ Create Customer
 * - OAuth login (firebaseUID present)
 * - Guest checkout (firebaseUID missing)
 */
router.post("/", createCustomer);

/**
 * ✅ Check if customer exists (Public)
 * Example:
 *  GET /api/customers/exists?email=test@gmail.com
 *  GET /api/customers/exists?phone=9876543210
 */
router.get("/exists", checkCustomerExists);

/**
 * ✅ Get all customers (Admin)
 */
router.get("/", getAllCustomers);

/**
 * ✅ Extra helpful routes (Admin)
 * - Find customer by customerId (0001, 0002...)
 * - Find customer by firebaseUID
 */
router.get("/by-customer-id/:customerId", getCustomerByCustomerId);
router.get("/by-firebase/:firebaseUID", getCustomerByFirebaseUID);

/**
 * ---------------------------------------------------------
 * ✅ CART ADDS ROUTES (customer _id based)
 * ---------------------------------------------------------
 * POST /api/customers/:id/cart-adds/add
 * Body: { productCode }
 *
 * POST /api/customers/:id/cart-adds/remove
 * Body: { productCode }
 *
 * POST /api/customers/:id/cart-adds/merge
 * Body: { productCodes: ["00131","00218"] }
 */
router.post("/:id/cart-adds/add", addCartAddByCustomerId);
router.post("/:id/cart-adds/remove", removeCartAddByCustomerId);
router.post("/:id/cart-adds/merge", mergeGuestCartAddsByCustomerId);

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
