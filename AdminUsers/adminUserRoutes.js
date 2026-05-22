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
  forceLogoutAdminUser,
  deleteAdminUser,
} from "./adminUserController.js";

import { protectAdmin } from "./protectAdmin.js";

const router = express.Router();

/**
 * ✅ BASE ROUTE: /api/admin-users
 *
 * ⚠️ IMPORTANT:
 * Put static routes like /login before /:id routes
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

/** ✅ Change Password + force old sessions logout */
router.patch("/:id/password", protectAdmin, changeAdminPassword);

/** ✅ Unlock Admin User */
router.patch("/:id/unlock", protectAdmin, unlockAdminUser);

/** ✅ Force Logout Admin User from all active sessions */
router.patch("/:id/force-logout", protectAdmin, forceLogoutAdminUser);

/** ✅ Get Single Admin User */
router.get("/:id", protectAdmin, getAdminUserById);

/** ✅ Delete Admin User */
router.delete("/:id", protectAdmin, deleteAdminUser);

export default router;