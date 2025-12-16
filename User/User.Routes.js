import express from "express";
import {
  createUser,
  listUsers,
  getUser,
  updateUser,
  deleteUser,
  toggleUserActive,
  updateUserPassword,
} from "./User.controller.js"; // adjust path if needed

const router = express.Router();

// ✅ Superadmin Users CRUD
router.get("/users", listUsers);
router.post("/users", createUser);

router.get("/users/:id", getUser);
router.put("/users/:id", updateUser);
router.delete("/users/:id", deleteUser);

router.patch("/users/:id/toggle-active", toggleUserActive);

// ✅ Dedicated password update endpoint (optional but clean)
router.patch("/users/:id/password", updateUserPassword);

export default router;
