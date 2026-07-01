import express from "express";

import {
  createVendorUser,
  loginVendorUser,
  getVendorProfile,
  getAllVendorUsers,
  updateVendorUser,
} from "./vendorUserController.js";

import { protectVendor } from "./vendorAuth.js";

const router = express.Router();

router.post("/create", createVendorUser);
router.post("/login", loginVendorUser);

router.get("/profile", protectVendor, getVendorProfile);

router.get("/", getAllVendorUsers);
router.put("/:id", updateVendorUser);

export default router;