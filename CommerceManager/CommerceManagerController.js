import CommerceManager from "./CommerceManager.js";

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

const normalizeCodes = (codes) => {
  if (!Array.isArray(codes)) return [];
  return [...new Set(codes.map(normalizeCode).filter(Boolean))];
};

const toSafeResponse = (doc) => {
  if (!doc) return null;

  return {
    _id: doc._id,
    name: doc.name,
    selectedProductCodes: doc.selectedProductCodes || [],
    selectedProductCodesCount: (doc.selectedProductCodes || []).length,
    isActive: doc.isActive,
    notes: doc.notes || "",
    lastUpdatedAt: doc.lastUpdatedAt,
    lastUpdatedBy: doc.lastUpdatedBy || "",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

/**
 * GET /api/commerce-manager
 */
export const getCommerceManagerConfig = async (req, res) => {
  try {
    const doc = await CommerceManager.getSingleton();
    return res.status(200).json({
      success: true,
      data: toSafeResponse(doc),
    });
  } catch (error) {
    console.error("getCommerceManagerConfig error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load commerce manager config",
    });
  }
};

/**
 * PUT /api/commerce-manager
 * body:
 * {
 *   selectedProductCodes: [],
 *   isActive: true,
 *   notes: "",
 *   lastUpdatedBy: ""
 * }
 */
export const upsertCommerceManagerConfig = async (req, res) => {
  try {
    const { selectedProductCodes, isActive, notes, lastUpdatedBy } = req.body;

    const doc = await CommerceManager.getSingleton();

    if (selectedProductCodes !== undefined) {
      doc.selectedProductCodes = normalizeCodes(selectedProductCodes);
    }

    if (typeof isActive === "boolean") {
      doc.isActive = isActive;
    }

    if (notes !== undefined) {
      doc.notes = String(notes ?? "").trim();
    }

    doc.touch(lastUpdatedBy);

    await doc.save();

    return res.status(200).json({
      success: true,
      message: "Commerce manager config updated successfully",
      data: toSafeResponse(doc),
    });
  } catch (error) {
    console.error("upsertCommerceManagerConfig error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update commerce manager config",
    });
  }
};

/**
 * POST /api/commerce-manager/product-codes
 * body:
 * {
 *   productCodes: [],
 *   lastUpdatedBy: ""
 * }
 */
export const addCommerceManagerProductCodes = async (req, res) => {
  try {
    const { productCodes = [], lastUpdatedBy = "" } = req.body;

    const incomingCodes = normalizeCodes(productCodes);

    if (!incomingCodes.length) {
      return res.status(400).json({
        success: false,
        message: "productCodes are required",
      });
    }

    const doc = await CommerceManager.getSingleton();

    const finalCodes = new Set(
      (doc.selectedProductCodes || []).map(normalizeCode).filter(Boolean)
    );

    for (const code of incomingCodes) {
      finalCodes.add(code);
    }

    doc.selectedProductCodes = [...finalCodes];
    doc.touch(lastUpdatedBy);

    await doc.save();

    return res.status(200).json({
      success: true,
      message: "Product codes added successfully",
      data: toSafeResponse(doc),
    });
  } catch (error) {
    console.error("addCommerceManagerProductCodes error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add product codes",
    });
  }
};

/**
 * DELETE /api/commerce-manager/product-codes
 * body:
 * {
 *   productCodes: [],
 *   lastUpdatedBy: ""
 * }
 */
export const removeCommerceManagerProductCodes = async (req, res) => {
  try {
    const { productCodes = [], lastUpdatedBy = "" } = req.body;

    const removeCodes = new Set(normalizeCodes(productCodes));

    if (!removeCodes.size) {
      return res.status(400).json({
        success: false,
        message: "productCodes are required",
      });
    }

    const doc = await CommerceManager.getSingleton();

    doc.selectedProductCodes = (doc.selectedProductCodes || []).filter(
      (code) => !removeCodes.has(normalizeCode(code))
    );

    doc.touch(lastUpdatedBy);

    await doc.save();

    return res.status(200).json({
      success: true,
      message: "Product codes removed successfully",
      data: toSafeResponse(doc),
    });
  } catch (error) {
    console.error("removeCommerceManagerProductCodes error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to remove product codes",
    });
  }
};

/**
 * DELETE /api/commerce-manager/product-codes/all
 * body:
 * {
 *   lastUpdatedBy: ""
 * }
 */
export const clearCommerceManagerProductCodes = async (req, res) => {
  try {
    const { lastUpdatedBy = "" } = req.body;

    const doc = await CommerceManager.getSingleton();
    doc.selectedProductCodes = [];
    doc.touch(lastUpdatedBy);

    await doc.save();

    return res.status(200).json({
      success: true,
      message: "All product codes cleared successfully",
      data: toSafeResponse(doc),
    });
  } catch (error) {
    console.error("clearCommerceManagerProductCodes error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to clear product codes",
    });
  }
};

/**
 * PATCH /api/commerce-manager/toggle
 * body:
 * {
 *   isActive: true,
 *   lastUpdatedBy: ""
 * }
 */
export const toggleCommerceManagerStatus = async (req, res) => {
  try {
    const { isActive, lastUpdatedBy = "" } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be true or false",
      });
    }

    const doc = await CommerceManager.getSingleton();
    doc.isActive = isActive;
    doc.touch(lastUpdatedBy);

    await doc.save();

    return res.status(200).json({
      success: true,
      message: `Commerce manager ${
        isActive ? "activated" : "deactivated"
      } successfully`,
      data: toSafeResponse(doc),
    });
  } catch (error) {
    console.error("toggleCommerceManagerStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to toggle commerce manager status",
    });
  }
};