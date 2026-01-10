import express from "express";

import {
  adminLogin,
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
 *
 * ⚠️ IMPORTANT:
 * Put /login BEFORE /:id routes
 * Otherwise "/login" will get caught by "/:id"
 */

/* ============================================================
   ✅ AUTH ROUTES
============================================================ */

/** ✅ LOGIN (public) */
router.post("/login", adminLogin);

/* ============================================================
   ✅ ADMIN USERS CRUD (protected)
============================================================ */

/** ✅ List Admin Users */
router.get("/", protectAdmin, getAdminUsers);

/** ✅ Create Admin User */
router.post("/", protectAdmin, createAdminUser);

/** ✅ Update Admin User (profile fields only) */
router.patch("/:id", protectAdmin, updateAdminUser);

/** ✅ Update Role + Permissions */
router.patch("/:id/role", protectAdmin, updateAdminRoleAndPermissions);

/** ✅ Change Password */
router.patch("/:id/password", protectAdmin, changeAdminPassword);

/** ✅ Unlock Admin User */
router.patch("/:id/unlock", protectAdmin, unlockAdminUser);

/** ✅ Get Single Admin User */
router.get("/:id", protectAdmin, getAdminUserById);

/** ✅ Delete Admin User */
router.delete("/:id", protectAdmin, deleteAdminUser);

export default router;
