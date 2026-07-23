import mongoose from "mongoose";
import Fabric from "../Fabric/Fabric.js";
import FabricPriceLog from "./FabricPriceLog.js";

/* ============================================================
   HELPERS
============================================================ */

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const buildSort = (sortBy = "effectiveFrom", sortOrder = "desc") => {
  const allowedSortFields = [
    "effectiveFrom",
    "createdAt",
    "updatedAt",
    "fabricCode",
    "fabricName",
    "oldPrice",
    "newPrice",
    "changeAmount",
    "changePercent",
    "createdBy",
  ];

  const field = allowedSortFields.includes(sortBy) ? sortBy : "effectiveFrom";
  const order = sortOrder === "asc" ? 1 : -1;

  return { [field]: order, createdAt: -1 };
};

const buildPriceLogQuery = (queryParams = {}) => {
  const {
    fabricId,
    fabricCode,
    fabricName,
    unit,
    createdBy,
    reason,
    search,
    minOldPrice,
    maxOldPrice,
    minNewPrice,
    maxNewPrice,
    minChangeAmount,
    maxChangeAmount,
    minChangePercent,
    maxChangePercent,
    fromDate,
    toDate,
    effectiveFrom,
    effectiveTo,
    priceIncreased,
    priceDecreased,
  } = queryParams;

  const query = {};

  if (fabricId && isValidObjectId(fabricId)) {
    query.fabric = fabricId;
  }

  if (fabricCode) {
    query.fabricCode = String(fabricCode).trim().toUpperCase();
  }

  if (fabricName) {
    query.fabricName = { $regex: String(fabricName).trim(), $options: "i" };
  }

  if (unit) {
    query.unit = unit;
  }

  if (createdBy) {
    query.createdBy = { $regex: String(createdBy).trim(), $options: "i" };
  }

  if (reason) {
    query.reason = { $regex: String(reason).trim(), $options: "i" };
  }

  if (search) {
    const regex = { $regex: String(search).trim(), $options: "i" };
    query.$or = [
      { fabricCode: regex },
      { fabricName: regex },
      { reason: regex },
      { note: regex },
      { createdBy: regex },
    ];
  }

  if (minOldPrice || maxOldPrice) {
    query.oldPrice = {};
    if (minOldPrice) query.oldPrice.$gte = toNumber(minOldPrice);
    if (maxOldPrice) query.oldPrice.$lte = toNumber(maxOldPrice);
  }

  if (minNewPrice || maxNewPrice) {
    query.newPrice = {};
    if (minNewPrice) query.newPrice.$gte = toNumber(minNewPrice);
    if (maxNewPrice) query.newPrice.$lte = toNumber(maxNewPrice);
  }

  if (minChangeAmount || maxChangeAmount) {
    query.changeAmount = {};
    if (minChangeAmount) query.changeAmount.$gte = toNumber(minChangeAmount);
    if (maxChangeAmount) query.changeAmount.$lte = toNumber(maxChangeAmount);
  }

  if (minChangePercent || maxChangePercent) {
    query.changePercent = {};
    if (minChangePercent) query.changePercent.$gte = toNumber(minChangePercent);
    if (maxChangePercent) query.changePercent.$lte = toNumber(maxChangePercent);
  }

  const startDate = parseDate(fromDate || effectiveFrom);
  const endDate = parseDate(toDate || effectiveTo);

  if (startDate || endDate) {
    query.effectiveFrom = {};
    if (startDate) query.effectiveFrom.$gte = startDate;
    if (endDate) query.effectiveFrom.$lte = endDate;
  }

  if (priceIncreased === "true") {
    query.changeAmount = { ...(query.changeAmount || {}), $gt: 0 };
  }

  if (priceDecreased === "true") {
    query.changeAmount = { ...(query.changeAmount || {}), $lt: 0 };
  }

  return query;
};

const getPagination = (query = {}) => {
  const page = Math.max(toNumber(query.page, 1), 1);
  const limit = Math.min(Math.max(toNumber(query.limit, 50), 1), 500);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

/* ============================================================
   CREATE PRICE LOG
============================================================ */

export const createFabricPriceLog = async (req, res) => {
  try {
    const {
      fabricId,
      fabricCode,
      newPrice,
      reason = "",
      note = "",
      effectiveFrom,
      createdBy = "admin",
      meta = {},
    } = req.body;

    if (!fabricId && !fabricCode) {
      return res.status(400).json({
        success: false,
        message: "fabricId or fabricCode is required",
      });
    }

    if (newPrice === undefined || newPrice === null || Number(newPrice) < 0) {
      return res.status(400).json({
        success: false,
        message: "Valid newPrice is required",
      });
    }

    const fabricQuery = fabricId
      ? { _id: fabricId }
      : { code: String(fabricCode).trim().toUpperCase() };

    const fabric = await Fabric.findOne(fabricQuery);

    if (!fabric) {
      return res.status(404).json({
        success: false,
        message: "Fabric not found",
      });
    }

    const lastPriceLog = await FabricPriceLog.findOne({
      fabric: fabric._id,
    }).sort({ effectiveFrom: -1, createdAt: -1 });

    const oldPrice = lastPriceLog?.newPrice || 0;

    const priceLog = await FabricPriceLog.create({
      fabric: fabric._id,
      fabricCode: fabric.code,
      fabricName: fabric.name,
      unit: fabric.unit,
      oldPrice,
      newPrice: Number(newPrice),
      reason,
      note,
      effectiveFrom: effectiveFrom || new Date(),
      createdBy,
      meta,
    });

    return res.status(201).json({
      success: true,
      message: "Fabric price log created successfully",
      data: priceLog,
    });
  } catch (error) {
    console.error("Create Fabric Price Log Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create fabric price log",
    });
  }
};

/* ============================================================
   GET ALL PRICE LOGS
============================================================ */

export const getAllFabricPriceLogs = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const query = buildPriceLogQuery(req.query);
    const sort = buildSort(req.query.sortBy, req.query.sortOrder);

    const [logs, total] = await Promise.all([
      FabricPriceLog.find(query).sort(sort).skip(skip).limit(limit).lean(),
      FabricPriceLog.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
      filters: query,
      sort,
    });
  } catch (error) {
    console.error("Get Fabric Price Logs Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch fabric price logs",
    });
  }
};

/* ============================================================
   GET SINGLE PRICE LOG
============================================================ */

export const getFabricPriceLogById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid price log id",
      });
    }

    const log = await FabricPriceLog.findById(id).lean();

    if (!log) {
      return res.status(404).json({
        success: false,
        message: "Fabric price log not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: log,
    });
  } catch (error) {
    console.error("Get Fabric Price Log By Id Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch fabric price log",
    });
  }
};

/* ============================================================
   UPDATE PRICE LOG
   Safe fields only
============================================================ */

export const updateFabricPriceLog = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid price log id",
      });
    }

    const allowedUpdates = [
      "reason",
      "note",
      "effectiveFrom",
      "createdBy",
      "meta",
    ];

    const update = {};

    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    });

    const updatedLog = await FabricPriceLog.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    });

    if (!updatedLog) {
      return res.status(404).json({
        success: false,
        message: "Fabric price log not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Fabric price log updated successfully",
      data: updatedLog,
    });
  } catch (error) {
    console.error("Update Fabric Price Log Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update fabric price log",
    });
  }
};

/* ============================================================
   DELETE PRICE LOG
============================================================ */

export const deleteFabricPriceLog = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid price log id",
      });
    }

    const deletedLog = await FabricPriceLog.findByIdAndDelete(id);

    if (!deletedLog) {
      return res.status(404).json({
        success: false,
        message: "Fabric price log not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Fabric price log deleted successfully",
      data: deletedLog,
    });
  } catch (error) {
    console.error("Delete Fabric Price Log Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete fabric price log",
    });
  }
};

/* ============================================================
   GET LATEST PRICE BY FABRIC
============================================================ */

export const getLatestFabricPrice = async (req, res) => {
  try {
    const { fabricId } = req.params;

    if (!isValidObjectId(fabricId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid fabric id",
      });
    }

    const latestPrice = await FabricPriceLog.findOne({
      fabric: fabricId,
    })
      .sort({ effectiveFrom: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: latestPrice,
    });
  } catch (error) {
    console.error("Get Latest Fabric Price Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch latest fabric price",
    });
  }
};

/* ============================================================
   GET LATEST PRICE BY FABRIC CODE
============================================================ */

export const getLatestFabricPriceByCode = async (req, res) => {
  try {
    const { fabricCode } = req.params;

    const latestPrice = await FabricPriceLog.findOne({
      fabricCode: String(fabricCode).trim().toUpperCase(),
    })
      .sort({ effectiveFrom: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: latestPrice,
    });
  } catch (error) {
    console.error("Get Latest Fabric Price By Code Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch latest fabric price",
    });
  }
};

/* ============================================================
   GET PRICE HISTORY BY FABRIC
============================================================ */

export const getFabricPriceHistory = async (req, res) => {
  try {
    const { fabricId } = req.params;

    if (!isValidObjectId(fabricId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid fabric id",
      });
    }

    const { page, limit, skip } = getPagination(req.query);
    const query = buildPriceLogQuery({ ...req.query, fabricId });
    const sort = buildSort(req.query.sortBy, req.query.sortOrder);

    const [logs, total] = await Promise.all([
      FabricPriceLog.find(query).sort(sort).skip(skip).limit(limit).lean(),
      FabricPriceLog.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get Fabric Price History Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch fabric price history",
    });
  }
};

/* ============================================================
   GET CURRENT PRICE LIST
   Latest price of every fabric
============================================================ */

export const getCurrentFabricPriceList = async (req, res) => {
  try {
    const {
      search,
      fabricCode,
      fabricName,
      unit,
      minPrice,
      maxPrice,
      sortBy = "fabricCode",
      sortOrder = "asc",
    } = req.query;

    const match = {};

    if (fabricCode) match.fabricCode = String(fabricCode).trim().toUpperCase();
    if (fabricName) {
      match.fabricName = { $regex: String(fabricName).trim(), $options: "i" };
    }
    if (unit) match.unit = unit;

    if (search) {
      const regex = { $regex: String(search).trim(), $options: "i" };
      match.$or = [{ fabricCode: regex }, { fabricName: regex }];
    }

    if (minPrice || maxPrice) {
      match.newPrice = {};
      if (minPrice) match.newPrice.$gte = toNumber(minPrice);
      if (maxPrice) match.newPrice.$lte = toNumber(maxPrice);
    }

    const allowedSortFields = [
      "fabricCode",
      "fabricName",
      "unit",
      "newPrice",
      "changeAmount",
      "changePercent",
      "effectiveFrom",
      "createdAt",
    ];

    const sortField = allowedSortFields.includes(sortBy) ? sortBy : "fabricCode";
    const sortDirection = sortOrder === "desc" ? -1 : 1;

    const { page, limit, skip } = getPagination(req.query);

    const pipeline = [
      { $sort: { effectiveFrom: -1, createdAt: -1 } },
      {
        $group: {
          _id: "$fabric",
          latest: { $first: "$$ROOT" },
        },
      },
      { $replaceRoot: { newRoot: "$latest" } },
      { $match: match },
      { $sort: { [sortField]: sortDirection } },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: "count" }],
        },
      },
    ];

    const result = await FabricPriceLog.aggregate(pipeline);

    const data = result?.[0]?.data || [];
    const total = result?.[0]?.total?.[0]?.count || 0;

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get Current Fabric Price List Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch current fabric price list",
    });
  }
};

/* ============================================================
   BULK CURRENT PRICES BY FABRIC IDS / CODES
============================================================ */

export const getBulkLatestFabricPrices = async (req, res) => {
  try {
    const { fabricIds = [], fabricCodes = [] } = req.body;

    const match = {};

    if (Array.isArray(fabricIds) && fabricIds.length) {
      match.fabric = {
        $in: fabricIds
          .filter(isValidObjectId)
          .map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    if (Array.isArray(fabricCodes) && fabricCodes.length) {
      match.fabricCode = {
        $in: fabricCodes.map((code) => String(code).trim().toUpperCase()),
      };
    }

    if (!Object.keys(match).length) {
      return res.status(400).json({
        success: false,
        message: "fabricIds or fabricCodes are required",
      });
    }

    const data = await FabricPriceLog.aggregate([
      { $match: match },
      { $sort: { effectiveFrom: -1, createdAt: -1 } },
      {
        $group: {
          _id: "$fabric",
          latest: { $first: "$$ROOT" },
        },
      },
      { $replaceRoot: { newRoot: "$latest" } },
      { $sort: { fabricCode: 1 } },
    ]);

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("Get Bulk Latest Fabric Prices Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch bulk latest fabric prices",
    });
  }
};

/* ============================================================
   ANALYTICS OVERVIEW
============================================================ */

export const getFabricPriceAnalytics = async (req, res) => {
  try {
    const query = buildPriceLogQuery(req.query);

    const [summary] = await FabricPriceLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalLogs: { $sum: 1 },
          uniqueFabrics: { $addToSet: "$fabric" },
          avgOldPrice: { $avg: "$oldPrice" },
          avgNewPrice: { $avg: "$newPrice" },
          minPrice: { $min: "$newPrice" },
          maxPrice: { $max: "$newPrice" },
          totalIncreaseAmount: {
            $sum: {
              $cond: [{ $gt: ["$changeAmount", 0] }, "$changeAmount", 0],
            },
          },
          totalDecreaseAmount: {
            $sum: {
              $cond: [{ $lt: ["$changeAmount", 0] }, "$changeAmount", 0],
            },
          },
          increasedCount: {
            $sum: {
              $cond: [{ $gt: ["$changeAmount", 0] }, 1, 0],
            },
          },
          decreasedCount: {
            $sum: {
              $cond: [{ $lt: ["$changeAmount", 0] }, 1, 0],
            },
          },
          unchangedCount: {
            $sum: {
              $cond: [{ $eq: ["$changeAmount", 0] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalLogs: 1,
          uniqueFabrics: { $size: "$uniqueFabrics" },
          avgOldPrice: { $round: ["$avgOldPrice", 2] },
          avgNewPrice: { $round: ["$avgNewPrice", 2] },
          minPrice: 1,
          maxPrice: 1,
          totalIncreaseAmount: { $round: ["$totalIncreaseAmount", 2] },
          totalDecreaseAmount: { $round: ["$totalDecreaseAmount", 2] },
          increasedCount: 1,
          decreasedCount: 1,
          unchangedCount: 1,
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      data: summary || {
        totalLogs: 0,
        uniqueFabrics: 0,
        avgOldPrice: 0,
        avgNewPrice: 0,
        minPrice: 0,
        maxPrice: 0,
        totalIncreaseAmount: 0,
        totalDecreaseAmount: 0,
        increasedCount: 0,
        decreasedCount: 0,
        unchangedCount: 0,
      },
    });
  } catch (error) {
    console.error("Get Fabric Price Analytics Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch fabric price analytics",
    });
  }
};

/* ============================================================
   PRICE TREND
============================================================ */

export const getFabricPriceTrend = async (req, res) => {
  try {
    const { groupBy = "month" } = req.query;
    const query = buildPriceLogQuery(req.query);

    const dateFormat =
      groupBy === "day"
        ? "%Y-%m-%d"
        : groupBy === "year"
        ? "%Y"
        : "%Y-%m";

    const data = await FabricPriceLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: {
            $dateToString: {
              format: dateFormat,
              date: "$effectiveFrom",
            },
          },
          totalLogs: { $sum: 1 },
          avgNewPrice: { $avg: "$newPrice" },
          avgChangeAmount: { $avg: "$changeAmount" },
          totalIncrease: {
            $sum: {
              $cond: [{ $gt: ["$changeAmount", 0] }, 1, 0],
            },
          },
          totalDecrease: {
            $sum: {
              $cond: [{ $lt: ["$changeAmount", 0] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          period: "$_id",
          totalLogs: 1,
          avgNewPrice: { $round: ["$avgNewPrice", 2] },
          avgChangeAmount: { $round: ["$avgChangeAmount", 2] },
          totalIncrease: 1,
          totalDecrease: 1,
        },
      },
      { $sort: { period: 1 } },
    ]);

    return res.status(200).json({
      success: true,
      groupBy,
      data,
    });
  } catch (error) {
    console.error("Get Fabric Price Trend Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch fabric price trend",
    });
  }
};

/* ============================================================
   TOP PRICE CHANGES
============================================================ */

export const getTopFabricPriceChanges = async (req, res) => {
  try {
    const { type = "increase", limit = 10 } = req.query;
    const query = buildPriceLogQuery(req.query);

    if (type === "decrease") {
      query.changeAmount = { ...(query.changeAmount || {}), $lt: 0 };
    } else if (type === "absolute") {
      // handled in aggregation
    } else {
      query.changeAmount = { ...(query.changeAmount || {}), $gt: 0 };
    }

    const pipeline = [
      { $match: query },
      {
        $addFields: {
          absoluteChangeAmount: { $abs: "$changeAmount" },
          absoluteChangePercent: { $abs: "$changePercent" },
        },
      },
      {
        $sort:
          type === "absolute"
            ? { absoluteChangeAmount: -1, createdAt: -1 }
            : type === "decrease"
            ? { changeAmount: 1, createdAt: -1 }
            : { changeAmount: -1, createdAt: -1 },
      },
      { $limit: Math.min(toNumber(limit, 10), 100) },
    ];

    const data = await FabricPriceLog.aggregate(pipeline);

    return res.status(200).json({
      success: true,
      type,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("Get Top Fabric Price Changes Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch top fabric price changes",
    });
  }
};

/* ============================================================
   PRICE LOGS BY FABRIC SUMMARY
============================================================ */

export const getFabricPriceSummaryByFabric = async (req, res) => {
  try {
    const query = buildPriceLogQuery(req.query);
    const { page, limit, skip } = getPagination(req.query);

    const data = await FabricPriceLog.aggregate([
      { $match: query },
      { $sort: { effectiveFrom: -1, createdAt: -1 } },
      {
        $group: {
          _id: "$fabric",
          fabricCode: { $first: "$fabricCode" },
          fabricName: { $first: "$fabricName" },
          unit: { $first: "$unit" },
          latestPrice: { $first: "$newPrice" },
          latestEffectiveFrom: { $first: "$effectiveFrom" },
          totalLogs: { $sum: 1 },
          minPrice: { $min: "$newPrice" },
          maxPrice: { $max: "$newPrice" },
          avgPrice: { $avg: "$newPrice" },
          totalChangeAmount: { $sum: "$changeAmount" },
        },
      },
      {
        $project: {
          _id: 0,
          fabric: "$_id",
          fabricCode: 1,
          fabricName: 1,
          unit: 1,
          latestPrice: 1,
          latestEffectiveFrom: 1,
          totalLogs: 1,
          minPrice: 1,
          maxPrice: 1,
          avgPrice: { $round: ["$avgPrice", 2] },
          totalChangeAmount: { $round: ["$totalChangeAmount", 2] },
        },
      },
      { $sort: { fabricCode: 1 } },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: "count" }],
        },
      },
    ]);

    const result = data?.[0] || {};
    const rows = result.data || [];
    const total = result.total?.[0]?.count || 0;

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get Fabric Price Summary By Fabric Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch fabric price summary",
    });
  }
};