import express from "express";
import {
  createAdminUser,
  getAllAdminUsers,
  getAdminUserById,
  updateAdminUser,
  deleteAdminUser,
  loginAdminUser,
  changePassword,
} from "../controllers/adminUserController.js";

import { protect, authorize } from "../middleware/authMiddleware.js"; 
// optional middleware for authentication & role-based access

const router = express.Router();

// 🔹 Public routes
router.post("/login", loginAdminUser); // admin login

// 🔹 Protected routes (authentication required)
router.use(protect); // all routes below require authentication

router.get("/", authorize("superadmin", "admin"), getAllAdminUsers); // list all admin users
router.get("/:id", authorize("superadmin", "admin"), getAdminUserById); // get single user by ID
router.post("/", authorize("superadmin"), createAdminUser); // create new admin user
router.put("/:id", authorize("superadmin"), updateAdminUser); // update user info
router.delete("/:id", authorize("superadmin"), deleteAdminUser); // delete user
router.put("/:id/change-password", changePassword); // change password

export default router;
