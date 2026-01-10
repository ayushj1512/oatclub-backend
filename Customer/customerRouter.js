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
