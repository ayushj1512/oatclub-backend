import mongoose from "mongoose";
import Fabric from "./Fabric.js";

/* ============================================================
   HELPERS
============================================================ */
const toBool = (value, fallback = undefined) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
};

const toNumber = (value, fallback = undefined) => {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeProductCodes = (arr = []) =>
  [...new Set(arr.map((v) => String(v || "").trim()).filter(Boolean))];

const normalizeFabricCode = (value = "") => {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";

  const digits = raw.replace(/^F/, "").replace(/\D/g, "");
  if (!digits) return raw;

  return `F${digits.padStart(5, "0")}`;
};

const buildFabricFilter = (query = {}) => {
  const {
    q,
    status,
    movementStatus,
    category,
    unit,
    isActive,
    code,
    name,
    minStock,
    maxStock,
  } = query;

  const filter = {};

  const parsedIsActive = toBool(isActive);
  if (parsedIsActive !== undefined) filter.isActive = parsedIsActive;

  if (status) filter.status = status;
  if (movementStatus) filter.movementStatus = movementStatus;
  if (category) filter.category = { $regex: category, $options: "i" };
  if (unit) filter.unit = unit;
  if (name) filter.name = { $regex: name, $options: "i" };

  if (code) {
    const normalizedCode = normalizeFabricCode(code);
    filter.code = { $regex: normalizedCode, $options: "i" };
  }

  const stockFilter = {};
  const parsedMinStock = toNumber(minStock);
  const parsedMaxStock = toNumber(maxStock);

  if (parsedMinStock !== undefined) stockFilter.$gte = parsedMinStock;
  if (parsedMaxStock !== undefined) stockFilter.$lte = parsedMaxStock;
  if (Object.keys(stockFilter).length) filter.currentStock = stockFilter;

  if (q) {
    const normalizedQ = normalizeFabricCode(q);
    filter.$or = [
      { name: { $regex: q, $options: "i" } },
      { code: { $regex: q, $options: "i" } },
      { code: { $regex: normalizedQ, $options: "i" } },
      { category: { $regex: q, $options: "i" } },
      { notes: { $regex: q, $options: "i" } },
      { associatedProductCodes: { $regex: q, $options: "i" } },
    ];
  }

  return filter;
};

const applyStockMeta = (payload = {}, existingStock = undefined) => {
  if (payload.currentStock === undefined) return payload;

  const stock = Number(payload.currentStock);
  if (!Number.isFinite(stock) || stock < 0) {
    throw new Error("currentStock must be a valid non-negative number");
  }

  payload.currentStock = stock;

  if (existingStock === undefined || stock !== existingStock) {
    payload.lastStockUpdatedAt = new Date();
  }

  return payload;
};

/* ============================================================
   CREATE FABRIC
============================================================ */
export const createFabric = async (req, res) => {
  try {
    const {
      name,
      category,
      unit,
      price = 0,
      imageLink = "",
      gsm = null,
      width = null,
      notes = "",
      status = "active",
      movementStatus = "idle",
      associatedProductCodes = [],
      isActive = true,
      currentStock = 0,
    } = req.body;

    if (!name || !category || !unit) {
      return res.status(400).json({
        success: false,
        message: "name, category and unit are required",
      });
    }

    const stock = Number(currentStock);
    if (!Number.isFinite(stock) || stock < 0) {
      return res.status(400).json({
        success: false,
        message: "currentStock must be a valid non-negative number",
      });
    }

    const fabric = await Fabric.create({
      name: String(name).trim(),
      category: String(category).trim(),
      unit,
      price,
      imageLink,
      gsm,
      width,
      notes,
      status,
      movementStatus,
      associatedProductCodes: normalizeProductCodes(associatedProductCodes),
      isActive,
      currentStock: stock,
      lastStockUpdatedAt: new Date(),
    });

    return res.status(201).json({
      success: true,
      message: "Fabric created successfully",
      data: fabric,
    });
  } catch (error) {
    console.error("❌ createFabric error:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate fabric code or unique field conflict",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create fabric",
      error: error.message,
    });
  }
};

/* ============================================================
   GET ALL FABRICS
============================================================ */
export const getFabrics = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const filter = buildFabricFilter(req.query);

    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 500);
    const skip = (pageNum - 1) * limitNum;

    const allowedSortFields = [
      "createdAt",
      "updatedAt",
      "name",
      "code",
      "category",
      "status",
      "movementStatus",
      "currentStock",
      "price",
    ];

    const finalSortBy = allowedSortFields.includes(sortBy)
      ? sortBy
      : "createdAt";

    const sort = {
      [finalSortBy]: sortOrder === "asc" ? 1 : -1,
    };

    const [data, total] = await Promise.all([
      Fabric.find(filter).sort(sort).skip(skip).limit(limitNum),
      Fabric.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("❌ getFabrics error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch fabrics",
      error: error.message,
    });
  }
};

/* ============================================================
   GET FABRIC OPTIONS
============================================================ */
export const getFabricOptions = async (_req, res) => {
  try {
    const fabrics = await Fabric.find({ isActive: true })
      .select(
        "name code category unit price status movementStatus currentStock lastStockUpdatedAt"
      )
      .sort({ name: 1 });

    return res.json({
      success: true,
      count: fabrics.length,
      data: fabrics,
    });
  } catch (error) {
    console.error("❌ getFabricOptions error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch fabric options",
      error: error.message,
    });
  }
};

/* ============================================================
   GET FABRIC BY ID
============================================================ */
export const getFabricById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid fabric id",
      });
    }

    const fabric = await Fabric.findById(id);

    if (!fabric) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    return res.json({
      success: true,
      data: fabric,
    });
  } catch (error) {
    console.error("❌ getFabricById error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch fabric",
      error: error.message,
    });
  }
};

/* ============================================================
   GET FABRIC BY CODE
============================================================ */
export const getFabricByCode = async (req, res) => {
  try {
    const { code } = req.params;
    const normalizedCode = normalizeFabricCode(code);

    const fabric = await Fabric.findOne({ code: normalizedCode });

    if (!fabric) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    return res.json({
      success: true,
      data: fabric,
    });
  } catch (error) {
    console.error("❌ getFabricByCode error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch fabric",
      error: error.message,
    });
  }
};

/* ============================================================
   UPDATE FABRIC
============================================================ */
export const updateFabric = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid fabric id",
      });
    }

    const existingFabric = await Fabric.findById(id);
    if (!existingFabric) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    const updates = { ...req.body };

    delete updates.code;
    delete updates._id;
    delete updates.createdAt;
    delete updates.updatedAt;
    delete updates.associatedProductsCount;

    if (updates.associatedProductCodes) {
      updates.associatedProductCodes = normalizeProductCodes(
        updates.associatedProductCodes
      );
    }

    applyStockMeta(updates, existingFabric.currentStock);

    const fabric = await Fabric.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    return res.json({
      success: true,
      message: "Fabric updated successfully",
      data: fabric,
    });
  } catch (error) {
    console.error("❌ updateFabric error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update fabric",
      error: error.message,
    });
  }
};

/* ============================================================
   PATCH FABRIC STATUS
============================================================ */
export const updateFabricStatus = async (req, res) => {
  try {
    const { status, isActive } = req.body;
    const allowedStatus = ["active", "inactive", "discontinued"];

    if (status && !allowedStatus.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    const updates = {};
    if (status) updates.status = status;
    if (isActive !== undefined) updates.isActive = Boolean(isActive);

    const fabric = await Fabric.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    if (!fabric) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    return res.json({
      success: true,
      message: "Fabric status updated successfully",
      data: fabric,
    });
  } catch (error) {
    console.error("❌ updateFabricStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update fabric status",
      error: error.message,
    });
  }
};

/* ============================================================
   PATCH MOVEMENT STATUS
============================================================ */
export const updateFabricMovementStatus = async (req, res) => {
  try {
    const { movementStatus } = req.body;
    const allowed = ["idle", "incoming", "in_use", "outgoing"];

    if (!allowed.includes(movementStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid movement status",
      });
    }

    const fabric = await Fabric.findByIdAndUpdate(
      req.params.id,
      { movementStatus },
      { new: true, runValidators: true }
    );

    if (!fabric) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    return res.json({
      success: true,
      message: "Movement status updated successfully",
      data: fabric,
    });
  } catch (error) {
    console.error("❌ updateFabricMovementStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update movement status",
      error: error.message,
    });
  }
};

/* ============================================================
   ADD PRODUCT CODES
============================================================ */
export const addAssociatedProductCodes = async (req, res) => {
  try {
    const { productCodes = [] } = req.body;

    if (!Array.isArray(productCodes) || !productCodes.length) {
      return res.status(400).json({
        success: false,
        message: "productCodes array is required",
      });
    }

    const fabric = await Fabric.findById(req.params.id);
    if (!fabric) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    fabric.associatedProductCodes = normalizeProductCodes([
      ...fabric.associatedProductCodes,
      ...productCodes,
    ]);

    await fabric.save();

    return res.json({
      success: true,
      message: "Product codes added successfully",
      data: fabric,
    });
  } catch (error) {
    console.error("❌ addAssociatedProductCodes error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add product codes",
      error: error.message,
    });
  }
};

/* ============================================================
   REMOVE PRODUCT CODES
============================================================ */
export const removeAssociatedProductCodes = async (req, res) => {
  try {
    const { productCodes = [] } = req.body;

    if (!Array.isArray(productCodes) || !productCodes.length) {
      return res.status(400).json({
        success: false,
        message: "productCodes array is required",
      });
    }

    const removeSet = new Set(
      productCodes.map((v) => String(v || "").trim()).filter(Boolean)
    );

    const fabric = await Fabric.findById(req.params.id);
    if (!fabric) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    fabric.associatedProductCodes = fabric.associatedProductCodes.filter(
      (code) => !removeSet.has(String(code))
    );

    await fabric.save();

    return res.json({
      success: true,
      message: "Product codes removed successfully",
      data: fabric,
    });
  } catch (error) {
    console.error("❌ removeAssociatedProductCodes error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to remove product codes",
      error: error.message,
    });
  }
};

/* ============================================================
   SOFT DELETE
============================================================ */
export const deleteFabric = async (req, res) => {
  try {
    const fabric = await Fabric.findByIdAndUpdate(
      req.params.id,
      { isActive: false, status: "inactive" },
      { new: true }
    );

    if (!fabric) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    return res.json({
      success: true,
      message: "Fabric deactivated successfully",
      data: fabric,
    });
  } catch (error) {
    console.error("❌ deleteFabric error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to deactivate fabric",
      error: error.message,
    });
  }
};

/* ============================================================
   ACTIVATE FABRIC
============================================================ */
export const activateFabric = async (req, res) => {
  try {
    const fabric = await Fabric.findByIdAndUpdate(
      req.params.id,
      { isActive: true, status: "active" },
      { new: true }
    );

    if (!fabric) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    return res.json({
      success: true,
      message: "Fabric activated successfully",
      data: fabric,
    });
  } catch (error) {
    console.error("❌ activateFabric error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to activate fabric",
      error: error.message,
    });
  }
};

/* ============================================================
   BULK UPDATE FABRICS
============================================================ */
export const bulkUpdateFabrics = async (req, res) => {
  try {
    const { ids = [], updates = {} } = req.body;

    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({
        success: false,
        message: "ids array is required",
      });
    }

    delete updates.code;
    delete updates._id;
    delete updates.createdAt;
    delete updates.updatedAt;
    delete updates.associatedProductsCount;

    if (updates.associatedProductCodes) {
      updates.associatedProductCodes = normalizeProductCodes(
        updates.associatedProductCodes
      );
    }

    if (updates.currentStock !== undefined) {
      const stock = Number(updates.currentStock);
      if (!Number.isFinite(stock) || stock < 0) {
        return res.status(400).json({
          success: false,
          message: "currentStock must be a valid non-negative number",
        });
      }
      updates.currentStock = stock;
      updates.lastStockUpdatedAt = new Date();
    }

    const result = await Fabric.updateMany(
      { _id: { $in: ids } },
      { $set: updates },
      { runValidators: true }
    );

    return res.json({
      success: true,
      message: "Bulk update completed successfully",
      matchedCount: result.matchedCount || 0,
      modifiedCount: result.modifiedCount || 0,
    });
  } catch (error) {
    console.error("❌ bulkUpdateFabrics error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to bulk update fabrics",
      error: error.message,
    });
  }
};

/* ============================================================
   FABRIC STATS
============================================================ */
export const getFabricStats = async (_req, res) => {
  try {
    const [counts, stockStats] = await Promise.all([
      Promise.all([
        Fabric.countDocuments({}),
        Fabric.countDocuments({ isActive: true }),
        Fabric.countDocuments({ status: "inactive" }),
        Fabric.countDocuments({ status: "discontinued" }),
        Fabric.countDocuments({ currentStock: 0 }),
      ]),
      Fabric.aggregate([
        {
          $group: {
            _id: null,
            totalStock: { $sum: "$currentStock" },
            avgStock: { $avg: "$currentStock" },
          },
        },
      ]),
    ]);

    const [total, active, inactive, discontinued, zeroStock] = counts;
    const stock = stockStats[0] || { totalStock: 0, avgStock: 0 };

    return res.json({
      success: true,
      data: {
        total,
        active,
        inactive,
        discontinued,
        zeroStock,
        totalStock: stock.totalStock || 0,
        avgStock: Number(stock.avgStock || 0).toFixed(2),
      },
    });
  } catch (error) {
    console.error("❌ getFabricStats error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch fabric stats",
      error: error.message,
    });
  }
};