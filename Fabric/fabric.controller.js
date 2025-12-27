import Fabric from "./Fabirc.js";
import Counter from "../models/Counter.js";

/* ============================================================
   HELPER → GENERATE FABRIC CODE (FAB-000123)
============================================================ */
const generateFabricCode = async () => {
  const counter = await Counter.findOneAndUpdate(
    { key: "fabric" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  return `FAB-${String(counter.seq).padStart(6, "0")}`;
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
      gsm = null,
      width = null,
      notes = "",
    } = req.body;

    if (!name || !category || !unit) {
      return res.status(400).json({
        success: false,
        message: "Name, category and unit are required",
      });
    }

    const code = await generateFabricCode();

    const fabric = await Fabric.create({
      name,
      code,
      category,
      unit,
      gsm,
      width,
      notes,
    });

    res.status(201).json({
      success: true,
      message: "Fabric created successfully",
      data: fabric,
    });
  } catch (error) {
    console.error("❌ Create Fabric Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create fabric",
    });
  }
};

/* ============================================================
   GET ALL FABRICS (FILTER + SEARCH)
============================================================ */
export const getFabrics = async (req, res) => {
  try {
    const {
      q,
      status,
      movementStatus,
      isActive = true,
    } = req.query;

    const filter = { isActive };

    if (status) filter.status = status;
    if (movementStatus) filter.movementStatus = movementStatus;

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { code: { $regex: q, $options: "i" } },
        { category: { $regex: q, $options: "i" } },
      ];
    }

    const fabrics = await Fabric.find(filter)
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: fabrics.length,
      data: fabrics,
    });
  } catch (error) {
    console.error("❌ Get Fabrics Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch fabrics",
    });
  }
};

/* ============================================================
   GET SINGLE FABRIC
============================================================ */
export const getFabricById = async (req, res) => {
  try {
    const fabric = await Fabric.findById(req.params.id);

    if (!fabric || !fabric.isActive) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    res.json({
      success: true,
      data: fabric,
    });
  } catch (error) {
    console.error("❌ Get Fabric Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch fabric",
    });
  }
};

/* ============================================================
   UPDATE FABRIC
============================================================ */
export const updateFabric = async (req, res) => {
  try {
    const updates = req.body;

    const fabric = await Fabric.findOneAndUpdate(
      { _id: req.params.id, isActive: true },
      updates,
      { new: true }
    );

    if (!fabric) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    res.json({
      success: true,
      message: "Fabric updated successfully",
      data: fabric,
    });
  } catch (error) {
    console.error("❌ Update Fabric Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update fabric",
    });
  }
};

/* ============================================================
   SOFT DELETE FABRIC
============================================================ */
export const deleteFabric = async (req, res) => {
  try {
    const fabric = await Fabric.findOneAndUpdate(
      { _id: req.params.id },
      {
        isActive: false,
        status: "inactive",
      },
      { new: true }
    );

    if (!fabric) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    res.json({
      success: true,
      message: "Fabric deactivated successfully",
    });
  } catch (error) {
    console.error("❌ Delete Fabric Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete fabric",
    });
  }
};

/* ============================================================
   UPDATE MOVEMENT STATUS (SYSTEM CONTROLLED)
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
      { new: true }
    );

    if (!fabric) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    res.json({
      success: true,
      message: "Movement status updated",
      data: fabric,
    });
  } catch (error) {
    console.error("❌ Movement Status Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update movement status",
    });
  }
};
