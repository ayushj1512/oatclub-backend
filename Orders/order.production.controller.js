import mongoose from "mongoose";
import ExcelJS from "exceljs";
import axios from "axios";

import Order from "./Orders.js";
import InventoryReservation from "../InventoryReservation/InventoryReservation.js";

/* ---------------- helpers ---------------- */

const toArray = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(toArray);
  if (typeof v === "string") {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [String(v)];
};

const parseIntSafe = (v, d) => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const parseBool = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
};

const buildSort = (sortStr) => {
  const raw = String(sortStr || "").trim();
  if (!raw) return { createdAt: -1 };

  const [field, dir] = raw.split(":").map((s) => s.trim());
  if (!field) return { createdAt: -1 };

  const order = String(dir || "desc").toLowerCase() === "asc" ? 1 : -1;
  return { [field]: order };
};

/**
 * IST-safe date range
 * from/to are YYYY-MM-DD
 * Converts to IST day boundaries then to UTC Date
 */
const IST_OFFSET_MIN = 330; // +05:30
const buildDateRangeIST = (from, to) => {
  const range = {};

  const mkUTCFromIST = (ymd, endOfDay = false) => {
    const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
    const d = new Date(`${ymd}T${time}Z`);
    if (Number.isNaN(d.getTime())) return null;
    const ms = d.getTime() - IST_OFFSET_MIN * 60 * 1000;
    return new Date(ms);
  };

  if (from) {
    const d = mkUTCFromIST(from, false);
    if (d && !Number.isNaN(d.getTime())) range.$gte = d;
  }
  if (to) {
    const d = mkUTCFromIST(to, true);
    if (d && !Number.isNaN(d.getTime())) range.$lte = d;
  }

  return Object.keys(range).length ? range : null;
};

const escapeRegex = (s = "") =>
  String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildPackedSearchOr = (q) => {
  const search = String(q || "").trim();
  if (!search) return null;

  const rx = new RegExp(escapeRegex(search), "i");

  return [
    { orderNumber: rx },
    { "customerId.name": rx }, // only works if populated in memory; kept harmless
    { "shippingAddressSnapshot.fullName": rx },
    { "shippingAddressSnapshot.phone": rx },
    { "shippingAddressSnapshot.email": rx },
    { "billingAddressSnapshot.fullName": rx },
    { "billingAddressSnapshot.phone": rx },
    { "billingAddressSnapshot.email": rx },
  ];
};

const buildMarkAllPackedFilters = (query = {}) => {
  const {
    q = "",
    customerName = "",
    from,
    to,
    provider,
    orderType,
    priority,
  } = query;

  const searchText = String(q || customerName || "").trim();

  const filters = {
    isConfirmed: true,
    fulfillmentStatus: "packed",

    // safety
    paymentStatus: { $ne: "failed" },
    orderType: { $ne: "parent" }, // avoid split-parent shipping
    $or: [
      { "shipment.status": { $exists: false } },
      { "shipment.status": { $ne: "cancelled" } },
    ],
  };

  const dateRange = buildDateRangeIST(from, to);
  if (dateRange) filters.orderDate = dateRange;

  const providers = toArray(provider);
  if (providers.length) {
    filters["shipment.provider"] =
      providers.length === 1 ? providers[0] : { $in: providers };
  }

  const orderTypes = toArray(orderType);
  if (orderTypes.length) {
    filters.orderType =
      orderTypes.length === 1 ? orderTypes[0] : { $in: orderTypes };
  }

  const priorities = toArray(priority);
  if (priorities.length) {
    filters.priority =
      priorities.length === 1 ? priorities[0] : { $in: priorities };
  }

  const searchOr = buildPackedSearchOr(searchText);
  if (searchOr) filters.$and = [{ $or: searchOr }];

  return filters;
};

/* ---------------- production jobs helpers ---------------- */

const buildProductionJobSort = (sort = "qty_desc") => {
  switch (String(sort || "").trim()) {
    case "qty_asc":
      return { totalQty: 1, sku: 1 };
    case "sku_asc":
      return { sku: 1 };
    case "sku_desc":
      return { sku: -1 };
    case "title_asc":
      return { productTitle: 1, sku: 1 };
    case "title_desc":
      return { productTitle: -1, sku: 1 };
    case "orders_desc":
      return { ordersCount: -1, totalQty: -1 };
    case "orders_asc":
      return { ordersCount: 1, totalQty: 1 };
    case "qty_desc":
    default:
      return { totalQty: -1, sku: 1 };
  }
};

const buildProductionJobSearchMatch = (search = "") => {
  const q = String(search || "").trim();
  if (!q) return null;

  const rx = new RegExp(escapeRegex(q), "i");

  return {
    $or: [
      { variantSku: rx },
      { productCode: rx },
      { productTitle: rx },
      { orderNumber: rx },
      { selectedSize: rx },
      { selectedColor: rx },
    ],
  };
};

const getProductionJobsBasePipeline = ({ search = "", from, to } = {}) => {
  const searchMatch = buildProductionJobSearchMatch(search);
  const dateRange = buildDateRangeIST(from, to);

  return [
    {
      $match: {
        refType: "order",
        status: "pending",
        ...(dateRange ? { createdAt: dateRange } : {}),
      },
    },
    {
      $lookup: {
        from: "orders",
        localField: "refId",
        foreignField: "_id",
        as: "orderDoc",
      },
    },
    {
      $unwind: {
        path: "$orderDoc",
        preserveNullAndEmptyArrays: false,
      },
    },
    {
      $match: {
        "orderDoc.isConfirmed": true,
      },
    },
    ...(searchMatch ? [{ $match: searchMatch }] : []),
    {
      $addFields: {
        effectiveSku: {
          $cond: [
            { $gt: [{ $strLenCP: { $ifNull: ["$variantSku", ""] } }, 0] },
            "$variantSku",
            "$productCode",
          ],
        },
      },
    },
    {
      $group: {
        _id: {
          sku: "$effectiveSku",
        },
        sku: { $first: "$effectiveSku" },
        productCode: { $first: "$productCode" },
        productTitle: { $first: "$productTitle" },
        productImage: { $first: "$productImage" },
        productModel: { $first: "$productModel" },
        productId: { $first: "$productId" },
        variantId: { $first: "$variantId" },

        totalQty: { $sum: "$qty" },
        orderIds: { $addToSet: "$refId" },
        reservationsCount: { $sum: 1 },

        sizes: {
          $push: {
            size: "$selectedSize",
            qty: "$qty",
          },
        },
        colors: {
          $push: {
            color: "$selectedColor",
            qty: "$qty",
          },
        },

        orderNumbers: { $addToSet: "$orderNumber" },

        rawReservations: {
          $push: {
            reservationId: "$_id",
            orderId: "$refId",
            orderNumber: "$orderNumber",
            qty: "$qty",
            selectedSize: "$selectedSize",
            selectedColor: "$selectedColor",
            variantSku: "$variantSku",
            productCode: "$productCode",
            productTitle: "$productTitle",
            productImage: "$productImage",
            createdAt: "$createdAt",
            confirmedAt: "$orderDoc.confirmedAt",
          },
        },

        latestCreatedAt: { $max: "$createdAt" },
        latestConfirmedAt: { $max: "$orderDoc.confirmedAt" },
      },
    },
    {
      $addFields: {
        ordersCount: { $size: "$orderIds" },
      },
    },
    {
      $project: {
        _id: 0,
        sku: 1,
        productCode: 1,
        productTitle: 1,
        productImage: 1,
        productModel: 1,
        productId: 1,
        variantId: 1,
        totalQty: 1,
        ordersCount: 1,
        reservationsCount: 1,
        sizes: 1,
        colors: 1,
        orderNumbers: 1,
        rawReservations: 1,
        latestCreatedAt: 1,
        latestConfirmedAt: 1,
      },
    },
  ];
};

const getRawReservationsPipeline = ({ search = "", from, to } = {}) => {
  const searchMatch = buildProductionJobSearchMatch(search);
  const dateRange = buildDateRangeIST(from, to);

  return [
    {
      $match: {
        refType: "order",
        status: "pending",
        ...(dateRange ? { createdAt: dateRange } : {}),
      },
    },
    {
      $lookup: {
        from: "orders",
        localField: "refId",
        foreignField: "_id",
        as: "orderDoc",
      },
    },
    {
      $unwind: {
        path: "$orderDoc",
        preserveNullAndEmptyArrays: false,
      },
    },
    {
      $match: {
        "orderDoc.isConfirmed": true,
      },
    },
    ...(searchMatch ? [{ $match: searchMatch }] : []),
    {
      $addFields: {
        sku: {
          $cond: [
            { $gt: [{ $strLenCP: { $ifNull: ["$variantSku", ""] } }, 0] },
            "$variantSku",
            "$productCode",
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        reservationId: "$_id",
        orderId: "$refId",
        orderNumber: 1,
        productModel: 1,
        productId: 1,
        variantId: 1,
        sku: 1,
        variantSku: 1,
        productCode: 1,
        productTitle: 1,
        productImage: 1,
        selectedSize: 1,
        selectedColor: 1,
        qty: 1,
        reservationStatus: "$status",
        isOrderConfirmed: "$orderDoc.isConfirmed",
        confirmedAt: "$orderDoc.confirmedAt",
        createdAt: 1,
      },
    },
  ];
};

const summarizePairs = (arr = [], keyName = "size") => {
  const map = new Map();

  for (const item of Array.isArray(arr) ? arr : []) {
    const k = String(item?.[keyName] || "").trim() || "NA";
    const qty = Number(item?.qty || 0);
    map.set(k, (map.get(k) || 0) + qty);
  }

  return Array.from(map.entries())
    .map(([key, qty]) => `${key}: ${qty}`)
    .join(", ");
};

/* ============================================================
   ✅ PRODUCTION JOB LIST (pending reservation + confirmed order)
============================================================ */
export const getProductionJobList = async (req, res) => {
  try {
    const {
      q = "",
      from,
      to,
      page = 1,
      limit = 50,
      sort = "qty_desc",
      all,
    } = req.query;

    const search = String(q || "").trim();
    const wantsAll = parseBool(all) || String(limit) === "0";

    const pageNum = parseIntSafe(page, 1);
    const limitNum = Math.min(parseIntSafe(limit, 50), 5000);
    const skip = (pageNum - 1) * limitNum;
    const sortStage = buildProductionJobSort(sort);

    const basePipeline = getProductionJobsBasePipeline({
      search,
      from,
      to,
    });

    const [rows, totalAgg, summaryAgg] = await Promise.all([
      InventoryReservation.aggregate([
        ...basePipeline,
        { $sort: sortStage },
        ...(wantsAll ? [] : [{ $skip: skip }, { $limit: limitNum }]),
      ]),
      InventoryReservation.aggregate([...basePipeline, { $count: "total" }]),
      InventoryReservation.aggregate([
        ...basePipeline,
        {
          $group: {
            _id: null,
            totalSkus: { $sum: 1 },
            totalQtyToProduce: { $sum: "$totalQty" },
            totalOrdersCovered: { $sum: "$ordersCount" },
            totalReservations: { $sum: "$reservationsCount" },
          },
        },
      ]),
    ]);

    const total = totalAgg?.[0]?.total || 0;
    const summary = summaryAgg?.[0] || {
      totalSkus: 0,
      totalQtyToProduce: 0,
      totalOrdersCovered: 0,
      totalReservations: 0,
    };

    return res.status(200).json({
      success: true,
      message: "Production job list fetched successfully",
      rows,
      summary,
      pagination: {
        total,
        page: wantsAll ? 1 : pageNum,
        limit: wantsAll ? rows.length : limitNum,
        pages: wantsAll ? 1 : Math.ceil(total / limitNum) || 1,
        hasMore: wantsAll ? false : skip + rows.length < total,
      },
      filtersApplied: {
        q: search,
        from: from || "",
        to: to || "",
        sort,
        all: wantsAll,
        logic: {
          reservationStatus: "pending",
          orderConfirmed: true,
          refType: "order",
        },
      },
    });
  } catch (error) {
    console.error("❌ getProductionJobList Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch production job list",
      error: error.message,
    });
  }
};

/* ============================================================
   ✅ EXPORT PRODUCTION JOB LIST EXCEL
============================================================ */
export const exportProductionJobListExcel = async (req, res) => {
  try {
    const {
      q = "",
      from,
      to,
      sort = "qty_desc",
    } = req.query;

    const search = String(q || "").trim();
    const sortStage = buildProductionJobSort(sort);

    const [jobRows, rawRows] = await Promise.all([
      InventoryReservation.aggregate([
        ...getProductionJobsBasePipeline({ search, from, to }),
        { $sort: sortStage },
      ]),
      InventoryReservation.aggregate([
        ...getRawReservationsPipeline({ search, from, to }),
        { $sort: { sku: 1, createdAt: 1 } },
      ]),
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "OpenAI";
    workbook.created = new Date();
    workbook.modified = new Date();

    const jobsSheet = workbook.addWorksheet("Job_List", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    const rawSheet = workbook.addWorksheet("Raw_Reservations", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    jobsSheet.columns = [
      { header: "Image", key: "image", width: 16 },
      { header: "Image URL", key: "productImage", width: 45 },
      { header: "SKU", key: "sku", width: 24 },
      { header: "Product Code", key: "productCode", width: 18 },
      { header: "Product Title", key: "productTitle", width: 34 },
      { header: "Total Qty To Produce", key: "totalQty", width: 18 },
      { header: "Orders Count", key: "ordersCount", width: 14 },
      { header: "Reservations Count", key: "reservationsCount", width: 16 },
      { header: "Sizes", key: "sizesText", width: 26 },
      { header: "Colors", key: "colorsText", width: 26 },
      { header: "Order Numbers", key: "orderNumbersText", width: 40 },
      { header: "Latest Confirmed At", key: "latestConfirmedAt", width: 22 },
      { header: "Latest Reservation At", key: "latestCreatedAt", width: 22 },
    ];

    rawSheet.columns = [
      { header: "Image URL", key: "productImage", width: 45 },
      { header: "Order Number", key: "orderNumber", width: 18 },
      { header: "SKU", key: "sku", width: 24 },
      { header: "Variant SKU", key: "variantSku", width: 24 },
      { header: "Product Code", key: "productCode", width: 18 },
      { header: "Product Title", key: "productTitle", width: 34 },
      { header: "Size", key: "selectedSize", width: 12 },
      { header: "Color", key: "selectedColor", width: 14 },
      { header: "Qty", key: "qty", width: 10 },
      { header: "Reservation Status", key: "reservationStatus", width: 18 },
      { header: "Order Confirmed", key: "isOrderConfirmed", width: 16 },
      { header: "Confirmed At", key: "confirmedAt", width: 22 },
      { header: "Reservation Created At", key: "createdAt", width: 22 },
    ];

    const styleHeader = (sheet) => {
      const row = sheet.getRow(1);
      row.font = { bold: true };
      row.alignment = { vertical: "middle", horizontal: "center" };
      row.height = 22;

      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });
    };

    styleHeader(jobsSheet);
    styleHeader(rawSheet);

    for (const item of jobRows) {
      jobsSheet.addRow({
        image: "",
        productImage: item.productImage || "",
        sku: item.sku || "",
        productCode: item.productCode || "",
        productTitle: item.productTitle || "",
        totalQty: Number(item.totalQty || 0),
        ordersCount: Number(item.ordersCount || 0),
        reservationsCount: Number(item.reservationsCount || 0),
        sizesText: summarizePairs(item.sizes, "size"),
        colorsText: summarizePairs(item.colors, "color"),
        orderNumbersText: Array.isArray(item.orderNumbers)
          ? item.orderNumbers.join(", ")
          : "",
        latestConfirmedAt: item.latestConfirmedAt
          ? new Date(item.latestConfirmedAt)
          : "",
        latestCreatedAt: item.latestCreatedAt
          ? new Date(item.latestCreatedAt)
          : "",
      });
    }

    for (const item of rawRows) {
      rawSheet.addRow({
        productImage: item.productImage || "",
        orderNumber: item.orderNumber || "",
        sku: item.sku || "",
        variantSku: item.variantSku || "",
        productCode: item.productCode || "",
        productTitle: item.productTitle || "",
        selectedSize: item.selectedSize || "",
        selectedColor: item.selectedColor || "",
        qty: Number(item.qty || 0),
        reservationStatus: item.reservationStatus || "",
        isOrderConfirmed: item.isOrderConfirmed ? "Yes" : "No",
        confirmedAt: item.confirmedAt ? new Date(item.confirmedAt) : "",
        createdAt: item.createdAt ? new Date(item.createdAt) : "",
      });
    }

    for (let i = 2; i <= jobsSheet.rowCount; i++) {
      const cell = jobsSheet.getCell(`B${i}`);
      if (typeof cell.value === "string" && /^https?:\/\//i.test(cell.value)) {
        cell.value = { text: cell.value, hyperlink: cell.value };
        cell.font = { color: { argb: "FF0563C1" }, underline: true };
      }
    }

    for (let i = 2; i <= rawSheet.rowCount; i++) {
      const cell = rawSheet.getCell(`A${i}`);
      if (typeof cell.value === "string" && /^https?:\/\//i.test(cell.value)) {
        cell.value = { text: cell.value, hyperlink: cell.value };
        cell.font = { color: { argb: "FF0563C1" }, underline: true };
      }
    }

    // optional thumbnail embed
    for (let i = 0; i < jobRows.length; i++) {
      const rowNumber = i + 2;
      const imageUrl = String(jobRows[i]?.productImage || "").trim();
      if (!/^https?:\/\//i.test(imageUrl)) continue;

      try {
        const response = await axios.get(imageUrl, {
          responseType: "arraybuffer",
          timeout: 8000,
        });

        const contentType = String(response.headers["content-type"] || "").toLowerCase();
        let extension = "png";
        if (contentType.includes("jpeg") || contentType.includes("jpg")) extension = "jpeg";
        else if (contentType.includes("png")) extension = "png";

        const imageId = workbook.addImage({
          buffer: Buffer.from(response.data),
          extension,
        });

        jobsSheet.getRow(rowNumber).height = 44;

        jobsSheet.addImage(imageId, {
          tl: { col: 0.15, row: rowNumber - 0.85 },
          ext: { width: 52, height: 52 },
        });
      } catch (_) {
        // ignore thumbnail failure
      }
    }

    [jobsSheet, rawSheet].forEach((sheet) => {
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        row.eachCell((cell) => {
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
        });
      });
    });

    const fileName = `production-job-list-${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error("❌ exportProductionJobListExcel Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export production job list excel",
      error: error.message,
    });
  }
};

/* ============================================================
   ✅ PRODUCTION QUEUE (Confirmed Orders Only)
============================================================ */
export const getProductionQueue = async (req, res) => {
  try {
    const {
      fulfillmentStatus = "processing",
      priority,
      orderType,
      provider,
      q,
      from,
      to,
      page = 1,
      limit = 25,
      sort,
      all,
      packability = "all", // all | packable | unpackable | true | false
    } = req.query;

    const filters = { isConfirmed: true };

    const statuses = toArray(fulfillmentStatus);
    if (statuses.length) {
      filters.fulfillmentStatus =
        statuses.length === 1 ? statuses[0] : { $in: statuses };
    }

    const priorities = toArray(priority);
    if (priorities.length) {
      filters.priority =
        priorities.length === 1 ? priorities[0] : { $in: priorities };
    }

    const orderTypes = toArray(orderType);
    if (orderTypes.length) {
      filters.orderType =
        orderTypes.length === 1 ? orderTypes[0] : { $in: orderTypes };
    }

    const providers = toArray(provider);
    if (providers.length) {
      filters["shipment.provider"] =
        providers.length === 1 ? providers[0] : { $in: providers };
    }

    const dateRange = buildDateRangeIST(from, to);
    if (dateRange) filters.orderDate = dateRange;

    const search = String(q ?? "").trim();
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filters.$or = [
        { orderNumber: rx },
        { "shippingAddressSnapshot.fullName": rx },
        { "shippingAddressSnapshot.phone": rx },
        { "shippingAddressSnapshot.email": rx },
        { "billingAddressSnapshot.fullName": rx },
        { "billingAddressSnapshot.phone": rx },
        { "billingAddressSnapshot.email": rx },
        { "items.productSnapshot.title": rx },
        { "items.productSnapshot.productCode": rx },
        { "items.variant.sku": rx },
        { "items.selectedSize": rx },
        { "items.selectedColor": rx },
      ];
    }

    const safePackability = String(packability || "all").trim().toLowerCase();

    if (["packable", "true", "1", "yes", "y"].includes(safePackability)) {
      filters.isPackable = true;
    } else if (["unpackable", "false", "0", "no", "n"].includes(safePackability)) {
      filters.isPackable = false;
    }

    const sortObj = buildSort(sort);
    const wantsAll = parseBool(all) || String(limit) === "0";
    const MAX_LIMIT = 200;

    const pageNum = Math.max(1, parseIntSafe(page, 1));
    const limitNumRaw = parseIntSafe(limit, 25);
    const limitNum = Math.min(limitNumRaw, MAX_LIMIT);
    const skip = (pageNum - 1) * limitNum;

    const query = Order.find(filters)
      .populate("customerId", "name email phone")
      .sort(sortObj)
      .lean();

    const [orders, total] = await Promise.all([
      wantsAll ? query : query.skip(skip).limit(limitNum),
      Order.countDocuments(filters),
    ]);

    return res.status(200).json({
      success: true,
      count: orders.length,
      total,
      page: wantsAll ? 1 : pageNum,
      limit: wantsAll ? orders.length : limitNum,
      pages: wantsAll ? 1 : Math.ceil(total / limitNum) || 1,
      all: wantsAll,
      filtersApplied: {
        fulfillmentStatus: statuses,
        priority: priorities,
        orderType: orderTypes,
        provider: providers,
        q: search || "",
        from: from || "",
        to: to || "",
        sort: sortObj,
        packability: safePackability,
        isPackable:
          ["packable", "true", "1", "yes", "y"].includes(safePackability)
            ? true
            : ["unpackable", "false", "0", "no", "n"].includes(safePackability)
            ? false
            : "all",
      },
      orders,
    });
  } catch (error) {
    console.error("❌ getProductionQueue Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/* ============================================================
   ✅ SINGLE: MARK ORDER SHIPPED FROM PRODUCTION
============================================================ */
export const markOrderShippedFromProduction = async (req, res) => {
  const session = await mongoose.startSession();
  const TAG = "🏭[PRODUCTION->SHIPPED]";

  try {
    const orderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    let updatedOrder = null;

    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      if (!order.isConfirmed) {
        throw new Error("Order must be confirmed before production/shipping");
      }

      if (order.fulfillmentStatus === "cancelled") {
        throw new Error("Cancelled order cannot be shipped");
      }

      if (order.fulfillmentStatus === "failed") {
        throw new Error("Failed order cannot be shipped");
      }

      if (String(order.orderType || "").toLowerCase() === "parent") {
        throw new Error("Parent split order cannot be shipped");
      }

      const current = String(order.fulfillmentStatus || "").toLowerCase();

      if (!["packed", "picked", "shipped"].includes(current)) {
        throw new Error("Only packed/picked orders can be marked shipped from production");
      }

      if (current === "shipped") {
        updatedOrder = order;
        return;
      }

      const now = new Date();

      order.fulfillmentStatus = "shipped";

      order.shipment = order.shipment || {};
      if (order.shipment.status !== "cancelled") {
        order.shipment.status = "shipped";
      }
      if (!order.shipment.shippedAt) {
        order.shipment.shippedAt = now;
      }

      order.trackingDetails = order.trackingDetails || {};
      if (!order.trackingDetails.shippedAt) {
        order.trackingDetails.shippedAt = now;
      }

      await order.save({ session });
      updatedOrder = order;
    });

    const finalOrder = await Order.findById(updatedOrder._id).lean();

    console.log(`${TAG} ✅ Order marked shipped`, {
      orderNumber: finalOrder?.orderNumber,
      orderId: String(finalOrder?._id),
    });

    return res.status(200).json({
      success: true,
      message:
        finalOrder.fulfillmentStatus === "shipped"
          ? "Order marked shipped from production"
          : "Order already shipped",
      order: finalOrder,
    });
  } catch (error) {
    console.error(`${TAG} ❌ Error:`, error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  } finally {
    session.endSession();
  }
};

/* ============================================================
   ✅ BULK: MARK ALL PACKED AS SHIPPED
   Supports search/filter based bulk update
============================================================ */
export const markAllPackedOrdersShipped = async (req, res) => {
  const session = await mongoose.startSession();
  const TAG = "🏭[BULK PACKED->SHIPPED]";

  try {
    let responsePayload = null;

    await session.withTransaction(async () => {
      const filters = buildMarkAllPackedFilters(req.query);
      const now = new Date();

      const matchingIds = await Order.find(filters)
        .select("_id orderNumber")
        .session(session)
        .lean();

      if (!matchingIds.length) {
        responsePayload = {
          success: true,
          message: "No packed orders found to mark as shipped",
          matchedCount: 0,
          modifiedCount: 0,
          orderIds: [],
          orderNumbers: [],
        };
        return;
      }

      const ids = matchingIds.map((o) => o._id);

      const updateResult = await Order.updateMany(
        { _id: { $in: ids } },
        {
          $set: {
            fulfillmentStatus: "shipped",
            "shipment.status": "shipped",
            "shipment.shippedAt": now,
            "trackingDetails.shippedAt": now,
            updatedAt: now,
          },
        },
        { session }
      );

      responsePayload = {
        success: true,
        message: `${updateResult.modifiedCount || 0} packed orders marked as shipped`,
        matchedCount: matchingIds.length,
        modifiedCount: updateResult.modifiedCount || 0,
        orderIds: ids,
        orderNumbers: matchingIds.map((o) => o.orderNumber).filter(Boolean),
      };
    });

    console.log(`${TAG} ✅ Bulk shipped`, {
      matchedCount: responsePayload?.matchedCount || 0,
      modifiedCount: responsePayload?.modifiedCount || 0,
    });

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error(`${TAG} ❌ Error:`, error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  } finally {
    session.endSession();
  }
};

/* ============================================================
   ✅ PRODUCTION SUMMARY
============================================================ */
export const getProductionSummary = async (req, res) => {
  try {
    const [summary] = await Order.aggregate([
      { $match: { isConfirmed: true } },
      {
        $group: {
          _id: null,
          processing: {
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "processing"] }, 1, 0],
            },
          },
          packed: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "packed"] }, 1, 0] },
          },
          picked: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "picked"] }, 1, 0] },
          },
          shipped: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "shipped"] }, 1, 0] },
          },
          delivered: {
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "delivered"] }, 1, 0],
            },
          },
          cancelled: {
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "cancelled"] }, 1, 0],
            },
          },
          rto: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "rto"] }, 1, 0] },
          },
          return_requested: {
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "return_requested"] }, 1, 0],
            },
          },
          exchange_requested: {
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "exchange_requested"] }, 1, 0],
            },
          },
          pickup_initiated: {
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "pickup_initiated"] }, 1, 0],
            },
          },
          returned: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "returned"] }, 1, 0] },
          },
          refunded: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "refunded"] }, 1, 0] },
          },
          exchanged: {
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "exchanged"] }, 1, 0],
            },
          },
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      summary: summary || {
        processing: 0,
        packed: 0,
        picked: 0,
        shipped: 0,
        delivered: 0,
        cancelled: 0,
        rto: 0,
        return_requested: 0,
        exchange_requested: 0,
        pickup_initiated: 0,
        returned: 0,
        refunded: 0,
        exchanged: 0,
      },
    });
  } catch (err) {
    console.error("❌ getProductionSummary Error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};


/* ============================================================
   ✅ PROCESSING ORDER PRODUCT LIST
   logic:
   - order.fulfillmentStatus = processing
   - orderType != parent
   - paymentStatus != failed
   - grouped product-code wise
============================================================ */
export const getProcessingOrderProductList = async (req, res) => {
  try {
    const {
      q = "",
      from,
      to,
      page = 1,
      limit = 50,
      sort = "qty_desc",
      all,
    } = req.query;

    const search = String(q || "").trim();
    const wantsAll = parseBool(all) || String(limit) === "0";

    const pageNum = parseIntSafe(page, 1);
    const limitNum = Math.min(parseIntSafe(limit, 50), 5000);
    const skip = (pageNum - 1) * limitNum;

    const dateRange = buildDateRangeIST(from, to);

    const baseMatch = {
      fulfillmentStatus: "processing",
      paymentStatus: { $ne: "failed" },
      orderType: { $ne: "parent" },
    };

    if (dateRange) {
      baseMatch.orderDate = dateRange;
    }

    const searchStages = search
      ? [
          {
            $match: {
              $or: [
                { orderNumber: new RegExp(escapeRegex(search), "i") },
                { "items.productSnapshot.productCode": new RegExp(escapeRegex(search), "i") },
                { "items.productSnapshot.title": new RegExp(escapeRegex(search), "i") },
                { "items.variant.sku": new RegExp(escapeRegex(search), "i") },
                { "items.selectedSize": new RegExp(escapeRegex(search), "i") },
                { "items.selectedColor": new RegExp(escapeRegex(search), "i") },
              ],
            },
          },
        ]
      : [];

    const sortStage = (() => {
      switch (String(sort || "").trim()) {
        case "qty_asc":
          return { totalQty: 1, productCode: 1 };
        case "sku_asc":
          return { sku: 1 };
        case "sku_desc":
          return { sku: -1 };
        case "title_asc":
          return { productTitle: 1, sku: 1 };
        case "title_desc":
          return { productTitle: -1, sku: 1 };
        case "orders_desc":
          return { ordersCount: -1, totalQty: -1, productCode: 1 };
        case "orders_asc":
          return { ordersCount: 1, totalQty: 1, productCode: 1 };
        case "qty_desc":
        default:
          return { totalQty: -1, productCode: 1 };
      }
    })();

    const pipeline = [
      { $match: baseMatch },
      ...searchStages,

      {
        $lookup: {
          from: "inventoryreservations",
          let: { orderId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$refType", "order"] },
                    { $eq: ["$refId", "$$orderId"] },
                    { $eq: ["$status", "reserved"] },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 0,
                qty: 1,
                productId: 1,
                variantId: 1,
                productCode: 1,
                variantSku: 1,
                selectedSize: 1,
                selectedColor: 1,
              },
            },
          ],
          as: "reservedReservations",
        },
      },

      { $unwind: "$items" },

      {
        $addFields: {
          productCode: { $ifNull: ["$items.productSnapshot.productCode", ""] },
          productTitle: { $ifNull: ["$items.productSnapshot.title", ""] },
          productImage: { $ifNull: ["$items.productSnapshot.thumbnail", ""] },
          sku: {
            $cond: [
              {
                $gt: [
                  { $strLenCP: { $ifNull: ["$items.variant.sku", ""] } },
                  0,
                ],
              },
              "$items.variant.sku",
              "$items.productSnapshot.productCode",
            ],
          },
          selectedSize: { $ifNull: ["$items.selectedSize", ""] },
          selectedColor: { $ifNull: ["$items.selectedColor", ""] },
          orderedQty: { $ifNull: ["$items.quantity", 0] },
          productModel: "$items.productModel",
          productId: "$items.productId",

          matchedReservedReservations: {
            $filter: {
              input: "$reservedReservations",
              as: "res",
              cond: {
                $and: [
                  {
                    $eq: [
                      { $ifNull: ["$$res.productCode", ""] },
                      { $ifNull: ["$items.productSnapshot.productCode", ""] },
                    ],
                  },
                  {
                    $eq: [
                      { $ifNull: ["$$res.variantSku", ""] },
                      { $ifNull: ["$items.variant.sku", ""] },
                    ],
                  },
                  {
                    $eq: [
                      { $ifNull: ["$$res.selectedSize", ""] },
                      { $ifNull: ["$items.selectedSize", ""] },
                    ],
                  },
                  {
                    $eq: [
                      { $ifNull: ["$$res.selectedColor", ""] },
                      { $ifNull: ["$items.selectedColor", ""] },
                    ],
                  },
                ],
              },
            },
          },
        },
      },

      {
        $addFields: {
          reservedQty: {
            $sum: {
              $map: {
                input: "$matchedReservedReservations",
                as: "r",
                in: { $ifNull: ["$$r.qty", 0] },
              },
            },
          },
        },
      },

      {
        $addFields: {
          qty: {
            $max: [
              {
                $subtract: ["$orderedQty", "$reservedQty"],
              },
              0,
            ],
          },
        },
      },

      {
        $match: {
          qty: { $gt: 0 },
        },
      },

      {
        $group: {
          _id: {
            productCode: "$productCode",
          },
          sku: { $first: "$sku" },
          productCode: { $first: "$productCode" },
          productTitle: { $first: "$productTitle" },
          productImage: { $first: "$productImage" },
          productModel: { $first: "$productModel" },
          productId: { $first: "$productId" },

          totalOrderedQty: { $sum: "$orderedQty" },
          totalReservedQty: { $sum: "$reservedQty" },
          totalQty: { $sum: "$qty" },

          orderIds: { $addToSet: "$_id" },
          orderNumbers: { $addToSet: "$orderNumber" },

          sizes: {
            $push: {
              size: "$selectedSize",
              qty: "$qty",
            },
          },
          colors: {
            $push: {
              color: "$selectedColor",
              qty: "$qty",
            },
          },

          rawOrders: {
            $push: {
              orderId: "$_id",
              orderNumber: "$orderNumber",
              orderedQty: "$orderedQty",
              reservedQty: "$reservedQty",
              qty: "$qty",
              selectedSize: "$selectedSize",
              selectedColor: "$selectedColor",
              sku: "$sku",
              productCode: "$productCode",
              productTitle: "$productTitle",
              productImage: "$productImage",
              orderDate: "$orderDate",
              createdAt: "$createdAt",
            },
          },

          latestOrderDate: { $max: "$orderDate" },
          latestCreatedAt: { $max: "$createdAt" },
        },
      },

      {
        $addFields: {
          ordersCount: { $size: "$orderIds" },
        },
      },

      {
        $project: {
          _id: 0,
          sku: 1,
          productCode: 1,
          productTitle: 1,
          productImage: 1,
          productModel: 1,
          productId: 1,
          totalOrderedQty: 1,
          totalReservedQty: 1,
          totalQty: 1,
          ordersCount: 1,
          orderIds: 1,
          sizes: 1,
          colors: 1,
          orderNumbers: 1,
          rawOrders: 1,
          latestOrderDate: 1,
          latestCreatedAt: 1,
        },
      },
    ];

    const [rows, totalAgg, summaryAgg] = await Promise.all([
      Order.aggregate([
        ...pipeline,
        { $sort: sortStage },
        ...(wantsAll ? [] : [{ $skip: skip }, { $limit: limitNum }]),
      ]),
      Order.aggregate([
        ...pipeline,
        { $count: "total" },
      ]),
      Order.aggregate([
        ...pipeline,
        {
          $group: {
            _id: null,
            totalSkus: { $sum: 1 },
            totalOrderedQty: { $sum: "$totalOrderedQty" },
            totalReservedQty: { $sum: "$totalReservedQty" },
            totalQtyToProduce: { $sum: "$totalQty" },
            allOrderIds: { $push: "$orderIds" },
          },
        },
        {
          $project: {
            _id: 0,
            totalSkus: 1,
            totalOrderedQty: 1,
            totalReservedQty: 1,
            totalQtyToProduce: 1,
            totalOrdersCovered: {
              $size: {
                $reduce: {
                  input: "$allOrderIds",
                  initialValue: [],
                  in: { $setUnion: ["$$value", "$$this"] },
                },
              },
            },
          },
        },
      ]),
    ]);

    const total = Number(totalAgg?.[0]?.total || 0);
    const pages = wantsAll ? 1 : Math.max(1, Math.ceil(total / limitNum));

    return res.status(200).json({
      message: "Processing order product list fetched successfully",
      rows,
      summary: {
        totalSkus: Number(summaryAgg?.[0]?.totalSkus || 0),
        totalOrderedQty: Number(summaryAgg?.[0]?.totalOrderedQty || 0),
        totalReservedQty: Number(summaryAgg?.[0]?.totalReservedQty || 0),
        totalQtyToProduce: Number(summaryAgg?.[0]?.totalQtyToProduce || 0),
        totalOrdersCovered: Number(summaryAgg?.[0]?.totalOrdersCovered || 0),
      },
      pagination: {
        total,
        page: wantsAll ? 1 : pageNum,
        limit: wantsAll ? total || limitNum : limitNum,
        pages,
        hasMore: wantsAll ? false : pageNum < pages,
      },
    });
  } catch (error) {
    console.error("getProcessingOrderProductList error:", error);
    return res.status(500).json({
      message: error.message || "Failed to fetch processing order product list",
    });
  }
};