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

/* ============================================================
   FABRIC SEARCH HELPERS
============================================================ */
const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeProductCode = (value = "") => {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (!raw) return "";

  // Numeric product codes are stored as 5 digits:
  // 279 → 00279
  if (/^\d+$/.test(raw)) {
    return raw.padStart(5, "0");
  }

  return raw;
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

const removePricingFields = (payload = {}) => {
  delete payload.price;
  delete payload.oldPrice;
  delete payload.newPrice;
  delete payload.changeAmount;
  delete payload.changePercent;
  return payload;
};

const buildFabricFilter = (query = {}) => {
  const {
    q,
    status,
    movementStatus,
    category,
    unit,
    isActive,
    isLowStock,
    code,
    name,
    minStock,
    maxStock,
  } = query;

  const filter = {};

  const parsedIsActive = toBool(isActive);

  if (parsedIsActive !== undefined) {
    filter.isActive = parsedIsActive;
  }

  const parsedIsLowStock = toBool(isLowStock);

  if (parsedIsLowStock !== undefined) {
    filter.isLowStock = parsedIsLowStock;
  }

  if (status) {
    filter.status = status;
  }

  if (movementStatus) {
    filter.movementStatus = movementStatus;
  }

  if (category) {
    filter.category = {
      $regex: category,
      $options: "i",
    };
  }

  if (unit) {
    filter.unit = unit;
  }

  if (name) {
    filter.name = {
      $regex: name,
      $options: "i",
    };
  }

  if (code) {
    const normalizedCode = normalizeFabricCode(code);

    filter.code = {
      $regex: normalizedCode,
      $options: "i",
    };
  }

  const stockFilter = {};

  const parsedMinStock = toNumber(minStock);
  const parsedMaxStock = toNumber(maxStock);

  if (parsedMinStock !== undefined) {
    stockFilter.$gte = parsedMinStock;
  }

  if (parsedMaxStock !== undefined) {
    stockFilter.$lte = parsedMaxStock;
  }

  if (Object.keys(stockFilter).length) {
    filter.currentStock = stockFilter;
  }

  if (q) {
    const normalizedQ = normalizeFabricCode(q);

    filter.$or = [
      {
        name: {
          $regex: q,
          $options: "i",
        },
      },
      {
        code: {
          $regex: q,
          $options: "i",
        },
      },
      {
        code: {
          $regex: normalizedQ,
          $options: "i",
        },
      },
      {
        category: {
          $regex: q,
          $options: "i",
        },
      },
      {
        notes: {
          $regex: q,
          $options: "i",
        },
      },
      {
        associatedProductCodes: {
          $regex: q,
          $options: "i",
        },
      },
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

const DEFAULT_LOW_STOCK_THRESHOLD = 20;

const validateLowStockThreshold = (value) => {
  const threshold = Number(value);

  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error(
      "lowStockThreshold must be a valid non-negative number"
    );
  }

  return threshold;
};

const calculateIsLowStock = (
  currentStock,
  lowStockThreshold = DEFAULT_LOW_STOCK_THRESHOLD
) => {
  const stock = Number(currentStock || 0);
  const threshold = Number(
    lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD
  );

  return stock <= threshold;
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
  imageLink = "",
  gsm = null,
  width = null,
  notes = "",
  status = "active",
  movementStatus = "idle",
  associatedProductCodes = [],
  isActive = true,
  currentStock = 0,
  lowStockThreshold = DEFAULT_LOW_STOCK_THRESHOLD,
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

    const threshold = validateLowStockThreshold(
  lowStockThreshold
);

    const fabric = await Fabric.create({
      name: String(name).trim(),
      category: String(category).trim(),
      unit,
      imageLink,
      gsm,
      width,
      notes,
      status,
      movementStatus,
      associatedProductCodes: normalizeProductCodes(associatedProductCodes),
      isActive,
      currentStock: stock,
lowStockThreshold: threshold,
isLowStock: calculateIsLowStock(stock, threshold),
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
"lowStockThreshold",
"isLowStock",
"lastStockUpdatedAt",
      "lastStockUpdatedAt",
      "associatedProductsCount",
      "isActive",
    ];

    const finalSortBy = allowedSortFields.includes(sortBy)
      ? sortBy
      : "createdAt";

    const sort = {
      [finalSortBy]: sortOrder === "asc" ? 1 : -1,
    };

    const [data, total] = await Promise.all([
      Fabric.find(filter).sort(sort).skip(skip).limit(limitNum).lean(),
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
  "name code category unit status movementStatus currentStock lowStockThreshold isLowStock lastStockUpdatedAt imageLink"
)
      .sort({ name: 1 })
      .lean();

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

    const fabric = await Fabric.findById(id).lean();

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

    const fabric = await Fabric.findOne({ code: normalizedCode }).lean();

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

    const updates = removePricingFields({ ...req.body });

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

    const cleanUpdates = removePricingFields({ ...updates });

    delete cleanUpdates.code;
    delete cleanUpdates._id;
    delete cleanUpdates.createdAt;
    delete cleanUpdates.updatedAt;
    delete cleanUpdates.associatedProductsCount;

    if (cleanUpdates.associatedProductCodes) {
      cleanUpdates.associatedProductCodes = normalizeProductCodes(
        cleanUpdates.associatedProductCodes
      );
    }

    if (cleanUpdates.currentStock !== undefined) {
      const stock = Number(cleanUpdates.currentStock);

      if (!Number.isFinite(stock) || stock < 0) {
        return res.status(400).json({
          success: false,
          message: "currentStock must be a valid non-negative number",
        });
      }

      cleanUpdates.currentStock = stock;
      cleanUpdates.lastStockUpdatedAt = new Date();
    }

    const result = await Fabric.updateMany(
      { _id: { $in: ids } },
      { $set: cleanUpdates },
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

/* ============================================================
   ASSIGN / SYNC PRODUCT CODES TO FABRIC

   PATCH /api/fabrics/:id/assign-products

   Body:
   {
     "productCodes": ["00229", "00230", "00311"]
   }

   This replaces the complete existing product-code assignment.
============================================================ */
export const assignProductCodesToFabric = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid fabric id",
      });
    }

    let { productCodes = [] } = req.body;

    // Also support comma-separated values
    if (typeof productCodes === "string") {
      productCodes = productCodes.split(",");
    }

    if (!Array.isArray(productCodes)) {
      return res.status(400).json({
        success: false,
        message: "productCodes must be an array or comma-separated string",
      });
    }

    const normalizedCodes = normalizeProductCodes(productCodes).map((code) => {
      const cleanCode = String(code || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");

      // Numeric product codes are stored as 5 digits
      if (/^\d+$/.test(cleanCode)) {
        return cleanCode.padStart(5, "0");
      }

      return cleanCode;
    });

    const fabric = await Fabric.findById(id);

    if (!fabric) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    fabric.associatedProductCodes = normalizedCodes;
    fabric.associatedProductsCount = normalizedCodes.length;

    await fabric.save();

    return res.status(200).json({
      success: true,
      message:
        normalizedCodes.length > 0
          ? `${normalizedCodes.length} product code(s) assigned successfully`
          : "All product codes removed from fabric",
      data: fabric,
    });
  } catch (error) {
    console.error("❌ assignProductCodesToFabric error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to assign product codes to fabric",
      error: error.message,
    });
  }
};

/* ============================================================
   GET LOW-STOCK FABRICS
============================================================ */
export const getLowStockFabrics = async (req, res) => {
  try {
    const fabrics = await Fabric.find({
      isLowStock: true,
      isActive: true,
      status: { $ne: "discontinued" },
    })
      .sort({ currentStock: 1 })
      .lean();

    return res.json({
      success: true,
      count: fabrics.length,
      data: fabrics,
    });
  } catch (error) {
    console.error("❌ getLowStockFabrics error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch low-stock fabrics",
      error: error.message,
    });
  }
};

/* ============================================================
   UPDATE ONE FABRIC THRESHOLD
============================================================ */
export const updateFabricLowStockThreshold = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { lowStockThreshold } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid fabric id",
      });
    }

    const threshold = validateLowStockThreshold(
      lowStockThreshold
    );

    const fabric = await Fabric.findById(id);

    if (!fabric) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    fabric.lowStockThreshold = threshold;
    fabric.isLowStock = calculateIsLowStock(
      fabric.currentStock,
      threshold
    );

    await fabric.save();

    return res.json({
      success: true,
      message: "Low-stock threshold updated successfully",
      data: fabric,
    });
  } catch (error) {
    console.error(
      "❌ updateFabricLowStockThreshold error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to update threshold",
      error: error.message,
    });
  }
};

/* ============================================================
   MANUALLY REFRESH ONE FABRIC LOW-STOCK STATUS
============================================================ */
export const refreshFabricLowStock = async (req, res) => {
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

    fabric.isLowStock = calculateIsLowStock(
      fabric.currentStock,
      fabric.lowStockThreshold
    );

    await fabric.save();

    return res.json({
      success: true,
      message: "Low-stock status refreshed successfully",
      data: fabric,
    });
  } catch (error) {
    console.error("❌ refreshFabricLowStock error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to refresh low-stock status",
      error: error.message,
    });
  }
};

/* ============================================================
   MANUALLY REFRESH ALL FABRICS
============================================================ */
export const refreshAllFabricsLowStock = async (
  _req,
  res
) => {
  try {
    const fabrics = await Fabric.find({});

    let lowStockCount = 0;

    for (const fabric of fabrics) {
      fabric.isLowStock = calculateIsLowStock(
        fabric.currentStock,
        fabric.lowStockThreshold
      );

      if (fabric.isLowStock) {
        lowStockCount += 1;
      }

      await fabric.save();
    }

    return res.json({
      success: true,
      message: "All fabric low-stock statuses refreshed",
      data: {
        total: fabrics.length,
        lowStockCount,
        healthyStockCount:
          fabrics.length - lowStockCount,
      },
    });
  } catch (error) {
    console.error(
      "❌ refreshAllFabricsLowStock error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to refresh fabrics",
      error: error.message,
    });
  }
};

/* ============================================================
   UPDATE THRESHOLD FOR ALL FABRICS
============================================================ */
export const updateAllFabricLowStockThresholds = async (
  req,
  res
) => {
  try {
    const { lowStockThreshold } = req.body;

    const threshold = validateLowStockThreshold(
      lowStockThreshold
    );

    const fabrics = await Fabric.find({});

    let lowStockCount = 0;

    for (const fabric of fabrics) {
      fabric.lowStockThreshold = threshold;

      fabric.isLowStock = calculateIsLowStock(
        fabric.currentStock,
        threshold
      );

      if (fabric.isLowStock) {
        lowStockCount += 1;
      }

      await fabric.save();
    }

    return res.json({
      success: true,
      message: `Threshold updated to ${threshold} for all fabrics`,
      data: {
        threshold,
        totalUpdated: fabrics.length,
        lowStockCount,
        healthyStockCount:
          fabrics.length - lowStockCount,
      },
    });
  } catch (error) {
    console.error(
      "❌ updateAllFabricLowStockThresholds error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to update all thresholds",
      error: error.message,
    });
  }
};


/* ============================================================
   SEARCH FABRICS

   GET /api/fabrics/search

   Supported query params:
   - q
   - name
   - fabricCode
   - code
   - category
   - productCode
   - status
   - movementStatus
   - unit
   - isActive
   - isLowStock
   - page
   - limit
   - sortBy
   - sortOrder

   Examples:
   /api/fabrics/search?q=cotton
   /api/fabrics/search?name=cotton
   /api/fabrics/search?fabricCode=12
   /api/fabrics/search?productCode=279
   /api/fabrics/search?category=knitted
============================================================ */
export const searchFabrics = async (req, res) => {
  try {
    const {
      q = "",
      name = "",
      fabricCode = "",
      code = "",
      category = "",
      productCode = "",
      status = "",
      movementStatus = "",
      unit = "",
      isActive,
      isLowStock,
      page = 1,
      limit = 20,
      sortBy = "name",
      sortOrder = "asc",
    } = req.query;

    const filter = {};

    /* -------------------------------
       GENERIC SEARCH
    -------------------------------- */
    const searchQuery = String(q || "").trim();

    if (searchQuery) {
      const escapedQuery = escapeRegex(searchQuery);
      const normalizedFabricCode =
        normalizeFabricCode(searchQuery);
      const normalizedProductCode =
        normalizeProductCode(searchQuery);

      const genericSearchConditions = [
        {
          name: {
            $regex: escapedQuery,
            $options: "i",
          },
        },
        {
          category: {
            $regex: escapedQuery,
            $options: "i",
          },
        },
        {
          code: {
            $regex: escapedQuery,
            $options: "i",
          },
        },
        {
          associatedProductCodes: {
            $regex: escapedQuery,
            $options: "i",
          },
        },
      ];

      if (normalizedFabricCode) {
        genericSearchConditions.push({
          code: {
            $regex: escapeRegex(normalizedFabricCode),
            $options: "i",
          },
        });
      }

      if (normalizedProductCode) {
        genericSearchConditions.push({
          associatedProductCodes: {
            $regex: escapeRegex(normalizedProductCode),
            $options: "i",
          },
        });
      }

      filter.$or = genericSearchConditions;
    }

    /* -------------------------------
       FABRIC NAME
    -------------------------------- */
    if (String(name || "").trim()) {
      filter.name = {
        $regex: escapeRegex(String(name).trim()),
        $options: "i",
      };
    }

    /* -------------------------------
       FABRIC CODE
    -------------------------------- */
    const requestedFabricCode = String(
      fabricCode || code || ""
    ).trim();

    if (requestedFabricCode) {
      const normalizedCode = normalizeFabricCode(
        requestedFabricCode
      );

      filter.code = {
        $regex: escapeRegex(normalizedCode),
        $options: "i",
      };
    }

    /* -------------------------------
       CATEGORY
    -------------------------------- */
    if (String(category || "").trim()) {
      filter.category = {
        $regex: escapeRegex(String(category).trim()),
        $options: "i",
      };
    }

    /* -------------------------------
       ASSOCIATED PRODUCT CODE
    -------------------------------- */
    if (String(productCode || "").trim()) {
      const rawProductCode = String(productCode).trim();
      const normalizedCode =
        normalizeProductCode(rawProductCode);

      /*
       Numeric product codes should normally match exactly
       after being converted to 5 digits.

       Non-numeric codes support partial case-insensitive search.
      */
      if (/^\d+$/.test(rawProductCode)) {
        filter.associatedProductCodes = normalizedCode;
      } else {
        filter.associatedProductCodes = {
          $regex: escapeRegex(normalizedCode),
          $options: "i",
        };
      }
    }

    /* -------------------------------
       OPTIONAL FILTERS
    -------------------------------- */
    if (status) {
      filter.status = status;
    }

    if (movementStatus) {
      filter.movementStatus = movementStatus;
    }

    if (unit) {
      filter.unit = unit;
    }

    const parsedIsActive = toBool(isActive);

    if (parsedIsActive !== undefined) {
      filter.isActive = parsedIsActive;
    }

    const parsedIsLowStock = toBool(isLowStock);

    if (parsedIsLowStock !== undefined) {
      filter.isLowStock = parsedIsLowStock;
    }

    /* -------------------------------
       PAGINATION
    -------------------------------- */
    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.min(
      Math.max(Number(limit) || 20, 1),
      100
    );

    const skip = (pageNum - 1) * limitNum;

    /* -------------------------------
       SORTING
    -------------------------------- */
    const allowedSortFields = [
      "name",
      "code",
      "category",
      "currentStock",
      "lowStockThreshold",
      "associatedProductsCount",
      "status",
      "movementStatus",
      "createdAt",
      "updatedAt",
    ];

    const finalSortBy = allowedSortFields.includes(sortBy)
      ? sortBy
      : "name";

    const sort = {
      [finalSortBy]:
        String(sortOrder).toLowerCase() === "desc"
          ? -1
          : 1,
    };

    /* -------------------------------
       DATABASE QUERY
    -------------------------------- */
    const [fabrics, total] = await Promise.all([
      Fabric.find(filter)
        .select(
          [
            "name",
            "code",
            "category",
            "unit",
            "imageLink",
            "gsm",
            "width",
            "currentStock",
            "lowStockThreshold",
            "isLowStock",
            "associatedProductCodes",
            "associatedProductsCount",
            "status",
            "movementStatus",
            "notes",
            "isActive",
            "lastStockUpdatedAt",
            "createdAt",
            "updatedAt",
          ].join(" ")
        )
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),

      Fabric.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      message:
        total > 0
          ? `${total} fabric result(s) found`
          : "No fabrics found",
      search: {
        q: searchQuery,
        name: String(name || "").trim(),
        fabricCode: requestedFabricCode,
        category: String(category || "").trim(),
        productCode: String(productCode || "").trim(),
      },
      total,
      count: fabrics.length,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      data: fabrics,
    });
  } catch (error) {
    console.error("❌ searchFabrics error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to search fabrics",
      error: error.message,
    });
  }
};