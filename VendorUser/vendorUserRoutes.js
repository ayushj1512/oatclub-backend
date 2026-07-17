import express from "express";

import {
  createVendorUser,
  loginVendorUser,
  getVendorProfile,
  getAllVendorUsers,
  getVendorUserById,
  updateVendorUser,
  deleteVendorUser,
  assignProductsToVendor,
  getVendorAssignedProducts,
  removeProductsFromVendor,
  updateAssignedProductModules,
} from "./vendorUserController.js";

import { protectVendor } from "./vendorAuth.js";

const router = express.Router();

/* Auth */
router.post("/create", createVendorUser);
router.post("/login", loginVendorUser);
router.get("/profile", protectVendor, getVendorProfile);

/* Vendor CRUD */
router.get("/", getAllVendorUsers);
router.get("/:id", getVendorUserById);
router.patch("/:id", updateVendorUser);
router.delete("/:id", deleteVendorUser);

/* Product assignments */
router.get("/:vendorId/products", getVendorAssignedProducts);
router.post("/:vendorId/products/assign", assignProductsToVendor);
router.delete("/:vendorId/products", removeProductsFromVendor);
router.patch(
  "/:vendorId/products/:productId",
  updateAssignedProductModules
);

export default router;