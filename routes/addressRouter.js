import express from "express";
import {
  createAddress,
  getAddressesByFirebaseUID,
  getAddressesByCustomer,
  getAddressById,
  updateAddress,
  deleteAddress,
} from "../controller/addressController.js";

const router = express.Router();

/**
 * ---------------------------------------------------------
 * CREATE ADDRESS
 * POST /api/addresses
 * ---------------------------------------------------------
 */
router.post("/", createAddress);

/**
 * ---------------------------------------------------------
 * GET ADDRESSES BY FIREBASE UID (Preferred Route)
 * GET /api/addresses/firebase/:firebaseUID
 * ---------------------------------------------------------
 */
router.get("/firebase/:firebaseUID", getAddressesByFirebaseUID);

/**
 * ---------------------------------------------------------
 * GET ADDRESSES BY CUSTOMER ID (Optional Route)
 * GET /api/addresses/customer/:customerId
 * ---------------------------------------------------------
 */
router.get("/customer/:customerId", getAddressesByCustomer);

/**
 * ---------------------------------------------------------
 * GET SINGLE ADDRESS BY _id
 * GET /api/addresses/single/:id
 * ---------------------------------------------------------
 */
router.get("/single/:id", getAddressById);

/**
 * ---------------------------------------------------------
 * UPDATE ADDRESS
 * PUT /api/addresses/:id
 * ---------------------------------------------------------
 */
router.put("/:id", updateAddress);

/**
 * ---------------------------------------------------------
 * DELETE ADDRESS
 * DELETE /api/addresses/:id
 * ---------------------------------------------------------
 */
router.delete("/:id", deleteAddress);

export default router;
