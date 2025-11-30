import express from "express";
import {
  createInventory,
  getAllInventory,
  getInventoryById,
  updateInventory,
  deleteInventory,
  adjustStock,
} from "../../controller/admin/inventoryController.js";

const router = express.Router();

// 🔹 Create a new inventory record
router.post("/", createInventory);

// 🔹 Get all inventory records
router.get("/", getAllInventory);

// 🔹 Get a single inventory record by ID
router.get("/:id", getInventoryById);

// 🔹 Update an inventory record by ID
router.put("/:id", updateInventory);

// 🔹 Delete an inventory record by ID
router.delete("/:id", deleteInventory);

// 🔹 Adjust stock (add/remove/reserve/release)
router.patch("/:id/adjust-stock", adjustStock);

export default router;
