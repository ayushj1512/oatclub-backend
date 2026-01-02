import express from "express";

import {
  adminLogin, // ✅ IMPORTANT: include this
  getAdminUsers,
  getAdminUserById,
  createAdminUser,
  updateAdminUser,
  updateAdminRoleAndPermissions,
  changeAdminPassword,
  unlockAdminUser,
  deleteAdminUser,
} from "./adminUserController.js";

import { protectAdmin } from "./protectAdmin.js";

const router = express.Router();

/**
 * ✅ BASE ROUTE: /api/admin-users
 * ✅ We will keep everything here (including /login)
 *
 * ⚠️ IMPORTANT:
 * Put /login BEFORE /:id routes
 * Otherwise "/login" will get caught by "/:id"
 */

/** ✅ LOGIN (public) */
router.post("/login", adminLogin);

/** ✅ List Admin Users (protected) */
router.get("/", protectAdmin, getAdminUsers);

/** ✅ Create Admin User (protected) */
router.post("/", protectAdmin, createAdminUser);

/** ✅ Update Role + Permissions (protected) */
router.patch("/:id/role", protectAdmin, updateAdminRoleAndPermissions);

/** ✅ Change Password (protected) */
router.patch("/:id/password", protectAdmin, changeAdminPassword);

/** ✅ Unlock User (protected) */
router.patch("/:id/unlock", protectAdmin, unlockAdminUser);

/** ✅ Update Admin User (protected) */
router.patch("/:id", protectAdmin, updateAdminUser);

/** ✅ Get Single Admin User (protected) */
router.get("/:id", protectAdmin, getAdminUserById);

/** ✅ Delete Admin User (protected) */
router.delete("/:id", protectAdmin, deleteAdminUser);

export default router;
