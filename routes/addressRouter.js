import express from "express";
import {
  createAddress,
  getAddressesByCustomer,
  getAddressById,
  updateAddress,
  deleteAddress,
} from "../controllers/addressController.js";

// Initialize router
const router = express.Router();

/**
 * @route   POST /api/addresses
 * @desc    Create a new address for a customer
 * @access  Private (requires authentication)
 */
router.post("/", createAddress);

/**
 * @route   GET /api/addresses/:customerId
 * @desc    Get all addresses for a specific customer
 * @access  Private
 */
router.get("/:customerId", getAddressesByCustomer);

/**
 * @route   GET /api/addresses/single/:id
 * @desc    Get a single address by its ID
 * @access  Private
 */
router.get("/single/:id", getAddressById);

/**
 * @route   PUT /api/addresses/:id
 * @desc    Update an existing address
 * @access  Private
 */
router.put("/:id", updateAddress);

/**
 * @route   DELETE /api/addresses/:id
 * @desc    Delete an address
 * @access  Private
 */
router.delete("/:id", deleteAddress);

export default router;
