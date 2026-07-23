  import mongoose from "mongoose";
  import FabricLog from "./FabricLog.js";
  import Fabric from "../Fabric/Fabric.js";

  /* ============================================================
    HELPERS
  ============================================================ */
  const toNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  };

  const normalizeFabricCode = (value = "") => {
    const raw = String(value || "").trim().toUpperCase();
    if (!raw) return "";

    const digits = raw.replace(/^F/, "").replace(/\D/g, "");
    if (!digits) return "";

    return `F${digits.padStart(5, "0")}`;
  };

  const buildDescription = ({ type, quantity, unit, newStock, fabricName }) => {
    if (type === "add") {
      return `Added ${quantity} ${unit} to ${fabricName}`;
    }

    if (type === "subtract") {
      return `Subtracted ${quantity} ${unit} from ${fabricName}`;
    }

    if (type === "adjust") {
      return `Adjusted stock of ${fabricName} to ${newStock} ${unit}`;
    }

    return `Updated fabric log for ${fabricName}`;
  };

  const getActionFromType = (type) => {
    if (type === "add") return "stock_added";
    if (type === "subtract") return "stock_subtracted";
    if (type === "adjust") return "stock_adjusted";
    return "updated";
  };

  /* ============================================================
    GET ALL FABRIC LOGS
    GET /api/fabric-logs
  ============================================================ */
  export const getFabricLogs = async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        q = "",
        action = "",
        type = "",
        startDate = "",
        endDate = "",
        sortBy = "logDate",
        sortOrder = "desc",
      } = req.query;

      const pageNum = Math.max(Number(page) || 1, 1);
      const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 200);
      const skip = (pageNum - 1) * limitNum;

      const filter = {};

      if (action) filter.action = action;
      if (type) filter.type = type;

      if (q) {
        const normalizedCode = normalizeFabricCode(q);

        filter.$or = [
          { fabricCode: { $regex: q, $options: "i" } },
          { fabricCode: { $regex: normalizedCode, $options: "i" } },
          { fabricName: { $regex: q, $options: "i" } },
          { description: { $regex: q, $options: "i" } },
          { note: { $regex: q, $options: "i" } },
          { createdBy: { $regex: q, $options: "i" } },
        ];
      }

      if (startDate || endDate) {
        filter.logDate = {};
        if (startDate) filter.logDate.$gte = new Date(startDate);
        if (endDate) {
          const dt = new Date(endDate);
          dt.setHours(23, 59, 59, 999);
          filter.logDate.$lte = dt;
        }
      }

      const allowedSort = ["logDate", "createdAt", "updatedAt", "fabricCode"];
      const finalSortBy = allowedSort.includes(sortBy) ? sortBy : "logDate";

      const sort = {
        [finalSortBy]: sortOrder === "asc" ? 1 : -1,
      };

      const [logs, total] = await Promise.all([
        FabricLog.find(filter).sort(sort).skip(skip).limit(limitNum),
        FabricLog.countDocuments(filter),
      ]);

      return res.status(200).json({
        success: true,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        count: logs.length,
        data: logs,
      });
    } catch (error) {
      console.error("❌ getFabricLogs error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch fabric logs",
        error: error.message,
      });
    }
  };

  /* ============================================================
    GET FABRIC LOGS BY CODE
    GET /api/fabric-logs/code/:code
  ============================================================ */
  export const getFabricLogsByCode = async (req, res) => {
    try {
      const { code } = req.params;
      const { page = 1, limit = 20, action = "", type = "" } = req.query;

      const normalizedCode = normalizeFabricCode(code);

      if (!normalizedCode) {
        return res.status(400).json({
          success: false,
          message: "Invalid fabric code",
        });
      }

      const pageNum = Math.max(Number(page) || 1, 1);
      const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 200);
      const skip = (pageNum - 1) * limitNum;

      const filter = { fabricCode: normalizedCode };
      if (action) filter.action = action;
      if (type) filter.type = type;

      const [logs, total] = await Promise.all([
        FabricLog.find(filter).sort({ logDate: -1 }).skip(skip).limit(limitNum),
        FabricLog.countDocuments(filter),
      ]);

      return res.status(200).json({
        success: true,
        fabricCode: normalizedCode,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        count: logs.length,
        data: logs,
      });
    } catch (error) {
      console.error("❌ getFabricLogsByCode error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch logs by code",
        error: error.message,
      });
    }
  };

  /* ============================================================
    GET SINGLE FABRIC LOG
    GET /api/fabric-logs/:id
  ============================================================ */
  export const getFabricLogById = async (req, res) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid log id",
        });
      }

      const log = await FabricLog.findById(id);

      if (!log) {
        return res.status(404).json({
          success: false,
          message: "Fabric log not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: log,
      });
    } catch (error) {
      console.error("❌ getFabricLogById error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch fabric log",
        error: error.message,
      });
    }
  };

  /* ============================================================
    CREATE FABRIC STOCK LOG
    POST /api/fabric-logs
    body:
    {
      code,
      type: add | subtract | adjust,
      quantity,
      description,
      note,
      logDate,
      createdBy
    }
  ============================================================ */
  export const createFabricStockLog = async (req, res) => {
    try {
      const {
        code,
        type,
        quantity,
        description = "",
        note = "",
        logDate,
        createdBy = "admin",
        meta = {},
      } = req.body;

      const normalizedCode = normalizeFabricCode(code);

      if (!normalizedCode) {
        return res.status(400).json({
          success: false,
          message: "Valid fabric code is required",
        });
      }

      if (!["add", "subtract", "adjust"].includes(type)) {
        return res.status(400).json({
          success: false,
          message: "type must be add, subtract or adjust",
        });
      }

      const qty = toNumber(quantity, NaN);
      if (!Number.isFinite(qty) || qty < 0) {
        return res.status(400).json({
          success: false,
          message: "quantity must be a valid non-negative number",
        });
      }

      const fabric = await Fabric.findOne({ code: normalizedCode, isActive: true });

      if (!fabric) {
        return res.status(404).json({
          success: false,
          message: "Fabric not found",
        });
      }

      const previousStock = Number(fabric.currentStock || 0);
      let newStock = previousStock;

      if (type === "add") {
        newStock = previousStock + qty;
      } else if (type === "subtract") {
        newStock = previousStock - qty;
      } else if (type === "adjust") {
        newStock = qty;
      }

      if (newStock < 0) {
        const blockedLog = await FabricLog.create({
          fabric: fabric._id,
          fabricCode: fabric.code,
          fabricName: fabric.name,
          unit: fabric.unit,
          action: "negative_stock_blocked",
          type: "subtract",
          quantity: qty,
          previousStock,
          newStock: previousStock,
          description:
            description ||
            `Blocked subtract request for ${fabric.name} due to insufficient stock`,
          note:
            note ||
            `Available stock is ${previousStock} ${fabric.unit}, requested ${qty} ${fabric.unit}`,
          message:
            description ||
            `Blocked subtract request for ${fabric.code}`,
          logDate: logDate ? new Date(logDate) : new Date(),
          createdBy,
          meta: {
            ...meta,
            attemptedType: type,
            attemptedQuantity: qty,
            attemptedNewStock: newStock,
          },
        });

        return res.status(400).json({
          success: false,
          message: `Insufficient stock. Available: ${previousStock} ${fabric.unit}`,
          data: blockedLog,
        });
      }

      fabric.currentStock = newStock;
      fabric.lastStockUpdatedAt = new Date();

      if (type === "add") {
        fabric.movementStatus = "incoming";
      } else if (type === "subtract") {
        fabric.movementStatus = "outgoing";
      } else if (type === "adjust" && newStock === 0) {
        fabric.movementStatus = "idle";
      }

      await fabric.save();

      const finalDescription =
        description ||
        buildDescription({
          type,
          quantity: qty,
          unit: fabric.unit,
          newStock,
          fabricName: fabric.name,
        });

      const log = await FabricLog.create({
        fabric: fabric._id,
        fabricCode: fabric.code,
        fabricName: fabric.name,
        unit: fabric.unit,
        action: getActionFromType(type),
        type,
        quantity: qty,
        previousStock,
        newStock,
        description: finalDescription,
        note,
        message: finalDescription,
        logDate: logDate ? new Date(logDate) : new Date(),
        createdBy,
        meta,
      });

      return res.status(201).json({
        success: true,
        message: "Fabric stock log created successfully",
        data: {
          log,
          fabric: {
            _id: fabric._id,
            name: fabric.name,
            code: fabric.code,
            unit: fabric.unit,
            currentStock: fabric.currentStock,
            movementStatus: fabric.movementStatus,
            lastStockUpdatedAt: fabric.lastStockUpdatedAt,
          },
        },
      });
    } catch (error) {
      console.error("❌ createFabricStockLog error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create fabric stock log",
        error: error.message,
      });
    }
  };