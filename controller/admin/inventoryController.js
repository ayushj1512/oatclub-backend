import Inventory from "../models/Inventory.js";

// 🔹 Create new inventory record
export const createInventory = async (req, res) => {
  try {
    const inventory = new Inventory(req.body);
    await inventory.save();
    res.status(201).json({ success: true, data: inventory });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// 🔹 Get all inventory records
export const getAllInventory = async (req, res) => {
  try {
    const inventoryList = await Inventory.find().populate("product");
    res.status(200).json({ success: true, data: inventoryList });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🔹 Get single inventory record by ID
export const getInventoryById = async (req, res) => {
  try {
    const inventory = await Inventory.findById(req.params.id).populate("product");
    if (!inventory) {
      return res.status(404).json({ success: false, message: "Inventory not found" });
    }
    res.status(200).json({ success: true, data: inventory });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🔹 Update inventory record
export const updateInventory = async (req, res) => {
  try {
    const inventory = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!inventory) {
      return res.status(404).json({ success: false, message: "Inventory not found" });
    }
    res.status(200).json({ success: true, data: inventory });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// 🔹 Delete inventory record
export const deleteInventory = async (req, res) => {
  try {
    const inventory = await Inventory.findByIdAndDelete(req.params.id);
    if (!inventory) {
      return res.status(404).json({ success: false, message: "Inventory not found" });
    }
    res.status(200).json({ success: true, message: "Inventory deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🔹 Adjust stock (add/remove/reserve)
export const adjustStock = async (req, res) => {
  try {
    const { action, quantity, referenceId, note } = req.body;
    const inventory = await Inventory.findById(req.params.id);
    if (!inventory) return res.status(404).json({ success: false, message: "Inventory not found" });

    switch (action) {
      case "add":
        inventory.stock.total += quantity;
        break;
      case "remove":
        inventory.stock.total = Math.max(0, inventory.stock.total - quantity);
        break;
      case "reserve":
        inventory.stock.reserved += quantity;
        break;
      case "release":
        inventory.stock.reserved = Math.max(0, inventory.stock.reserved - quantity);
        break;
      default:
        return res.status(400).json({ success: false, message: "Invalid action type" });
    }

    // log movement
    inventory.movementHistory.push({ action, quantity, referenceId, note });
    await inventory.save();

    res.status(200).json({ success: true, data: inventory });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
