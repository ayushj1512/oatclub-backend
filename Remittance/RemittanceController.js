import fs from "fs";
import csv from "csv-parser";
import ExcelJS from "exceljs";
import Remittance from "./Remittance.js";
import Order from "../Orders/Orders.js";

/* helpers */

const safe = (v) => String(v ?? "").trim();
const normalizeOrderNumber = (v) => safe(v).toUpperCase();
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeOrderType = (value) => {
  const v = safe(value).toLowerCase();
  if (v === "cod") return "cod";
  if (v === "razorpay" || v === "prepaid") return "razorpay";
  return "";
};

const parseDate = (value) => {
  if (!value) return null;
  const s = safe(value);
  if (!s) return null;

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const dash = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;

  if (slash.test(s)) {
    const [, d, m, y] = s.match(slash);
    const dt = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  if (dash.test(s)) {
    const [, d, m, y] = s.match(dash);
    const dt = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const parseAmount = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const formatDate = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
};

const buildListQuery = (query = {}) => {
  const {
    search = "",
    orderType = "",
    from = "",
    to = "",
    remittanceFrom = "",
    remittanceTo = "",
    minAmount = "",
    maxAmount = "",
  } = query;

  const q = {};

  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    q.$or = [
      { orderNumber: rx },
      { ewayBillId: rx },
      { shippingNo: rx },
      { orderType: rx },
    ];
  }

  if (orderType) q.orderType = normalizeOrderType(orderType);

  if (from || to) {
    q.deliveredDate = {};
    if (from) q.deliveredDate.$gte = parseDate(from);
    if (to) {
      const t = parseDate(to);
      if (t) {
        t.setUTCHours(23, 59, 59, 999);
        q.deliveredDate.$lte = t;
      }
    }
    if (!q.deliveredDate.$gte && !q.deliveredDate.$lte) delete q.deliveredDate;
  }

  if (remittanceFrom || remittanceTo) {
    q.remittanceDate = {};
    if (remittanceFrom) q.remittanceDate.$gte = parseDate(remittanceFrom);
    if (remittanceTo) {
      const t = parseDate(remittanceTo);
      if (t) {
        t.setUTCHours(23, 59, 59, 999);
        q.remittanceDate.$lte = t;
      }
    }
    if (!q.remittanceDate.$gte && !q.remittanceDate.$lte) delete q.remittanceDate;
  }

  if (minAmount !== "" || maxAmount !== "") {
    q.remittedAmount = {};
    if (minAmount !== "") q.remittedAmount.$gte = Number(minAmount) || 0;
    if (maxAmount !== "") q.remittedAmount.$lte = Number(maxAmount) || 0;
    if (q.remittedAmount.$gte === undefined && q.remittedAmount.$lte === undefined) {
      delete q.remittedAmount;
    }
  }

  return q;
};

const buildSort = (sortBy = "createdAt", sortOrder = "desc") => {
  const allowed = new Set([
    "createdAt",
    "updatedAt",
    "orderNumber",
    "deliveredDate",
    "remittanceDate",
    "remittedAmount",
    "orderType",
  ]);

  const field = allowed.has(sortBy) ? sortBy : "createdAt";
  return { [field]: sortOrder === "asc" ? 1 : -1 };
};

const getShippingNoExpr = () => ({
  $ifNull: [
    "$shipment.xpressbees.awb",
    {
      $ifNull: [
        "$shipment.shiprocket.awb",
        { $ifNull: ["$shipment.awb", "$trackingDetails.trackingId"] },
      ],
    },
  ],
});

const getDeliveredDateExpr = () => ({
  $ifNull: ["$shipment.deliveredAt", "$trackingDetails.deliveredAt"],
});

const getPendingBasePipeline = (search = "") => {
  const orderMatch = {
    orderType: "shipment",
    fulfillmentStatus: "delivered",
  };

  if (search) {
    orderMatch.orderNumber = new RegExp(escapeRegex(search), "i");
  }

  return [
    { $match: orderMatch },
    { $addFields: { deliveredDate: getDeliveredDateExpr() } },
    {
      $lookup: {
        from: "remittances",
        localField: "orderNumber",
        foreignField: "orderNumber",
        as: "remittanceDoc",
      },
    },
    { $addFields: { remittanceDoc: { $arrayElemAt: ["$remittanceDoc", 0] } } },
    {
      $match: {
        $or: [
          { remittanceDoc: { $eq: null } },
          { "remittanceDoc.remittanceDate": { $eq: null } },
          { "remittanceDoc.remittedAmount": { $lte: 0 } },
        ],
      },
    },
  ];
};

const csvRowToDoc = (row = {}) => {
  const mapped = {
    ewayBillId:
      row.ewayBillId || row.eway_bill_id || row["eway bill id"] || "",
    shippingNo:
      row.shippingNo || row.shipping_no || row["shipping no"] || row.awb || "",
    orderNumber:
      row.orderNumber || row.order_number || row["order number"] || "",
    deliveredDate:
      row.deliveredDate || row.delivered_date || row["delivered date"] || "",
    orderType:
      row.orderType || row.order_type || row["order type"] || "",
    remittanceDate:
      row.remittanceDate || row.remittance_date || row["remittance date"] || "",
    remittedAmount:
      row.remittedAmount ||
      row.remitted_amount ||
      row["remitted amount"] ||
      row.amount ||
      "",
  };

  return {
    ewayBillId: safe(mapped.ewayBillId),
    shippingNo: safe(mapped.shippingNo),
    orderNumber: normalizeOrderNumber(mapped.orderNumber),
    deliveredDate: parseDate(mapped.deliveredDate),
    orderType: normalizeOrderType(mapped.orderType),
    remittanceDate: parseDate(mapped.remittanceDate),
    remittedAmount: parseAmount(mapped.remittedAmount),
  };
};

/* CRUD */

export const createRemittance = async (req, res) => {
  try {
    const payload = {
      ewayBillId: safe(req.body.ewayBillId),
      shippingNo: safe(req.body.shippingNo),
      orderNumber: normalizeOrderNumber(req.body.orderNumber),
      deliveredDate: parseDate(req.body.deliveredDate),
      orderType: normalizeOrderType(req.body.orderType),
      remittanceDate: parseDate(req.body.remittanceDate),
      remittedAmount: parseAmount(req.body.remittedAmount),
    };

    if (!payload.orderNumber) {
      return res.status(400).json({ message: "orderNumber is required" });
    }

    const exists = await Remittance.exists({ orderNumber: payload.orderNumber });
    if (exists) {
      return res.status(409).json({ message: "Remittance already exists for this orderNumber" });
    }

    const doc = await Remittance.create(payload);
    return res.status(201).json({ message: "Remittance created successfully", data: doc });
  } catch (error) {
    return res.status(500).json({ message: "createRemittance error", error: error.message });
  }
};

export const getRemittances = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const skip = (page - 1) * limit;

    const filter = buildListQuery(req.query);
    const sort = buildSort(req.query.sortBy, req.query.sortOrder);

    const [rows, totalCount] = await Promise.all([
      Remittance.find(filter)
        .select("ewayBillId shippingNo orderNumber deliveredDate orderType remittanceDate remittedAmount createdAt updatedAt")
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Remittance.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limit) || 1;

    return res.json({
      message: "Remittances fetched successfully",
      data: rows,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "getRemittances error", error: error.message });
  }
};

export const getRemittanceById = async (req, res) => {
  try {
    const doc = await Remittance.findById(req.params.id)
      .select("ewayBillId shippingNo orderNumber deliveredDate orderType remittanceDate remittedAmount createdAt updatedAt")
      .lean();

    if (!doc) return res.status(404).json({ message: "Remittance not found" });

    return res.json({ message: "Remittance fetched successfully", data: doc });
  } catch (error) {
    return res.status(500).json({ message: "getRemittanceById error", error: error.message });
  }
};

export const updateRemittance = async (req, res) => {
  try {
    const update = {};

    if ("ewayBillId" in req.body) update.ewayBillId = safe(req.body.ewayBillId);
    if ("shippingNo" in req.body) update.shippingNo = safe(req.body.shippingNo);
    if ("orderNumber" in req.body) update.orderNumber = normalizeOrderNumber(req.body.orderNumber);
    if ("deliveredDate" in req.body) update.deliveredDate = parseDate(req.body.deliveredDate);
    if ("orderType" in req.body) update.orderType = normalizeOrderType(req.body.orderType);
    if ("remittanceDate" in req.body) update.remittanceDate = parseDate(req.body.remittanceDate);
    if ("remittedAmount" in req.body) update.remittedAmount = parseAmount(req.body.remittedAmount);

    if (update.orderNumber) {
      const clash = await Remittance.findOne({
        orderNumber: update.orderNumber,
        _id: { $ne: req.params.id },
      }).select("_id").lean();

      if (clash) {
        return res.status(409).json({ message: "Another remittance already exists with this orderNumber" });
      }
    }

    const doc = await Remittance.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!doc) return res.status(404).json({ message: "Remittance not found" });

    return res.json({ message: "Remittance updated successfully", data: doc });
  } catch (error) {
    return res.status(500).json({ message: "updateRemittance error", error: error.message });
  }
};

export const deleteRemittance = async (req, res) => {
  try {
    const doc = await Remittance.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: "Remittance not found" });
    return res.json({ message: "Remittance deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "deleteRemittance error", error: error.message });
  }
};

/* CSV import */

export const importRemittanceCsv = async (req, res) => {
  try {
    if (!req.file?.path) {
      return res.status(400).json({ message: "CSV file is required" });
    }

    const rows = [];
    const invalidRows = [];
    let rowNumber = 1;

    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on("data", (row) => {
          rowNumber += 1;
          const doc = csvRowToDoc(row);
          if (!doc.orderNumber) {
            invalidRows.push({ rowNumber, reason: "orderNumber missing", row });
            return;
          }
          rows.push(doc);
        })
        .on("end", resolve)
        .on("error", reject);
    });

    if (!rows.length) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ message: "No valid rows found in CSV", invalidRows });
    }

    const uniqueRows = [...new Map(rows.map((r) => [r.orderNumber, r])).values()];

    const ops = uniqueRows.map((doc) => ({
      updateOne: {
        filter: { orderNumber: doc.orderNumber },
        update: {
          $set: {
            ewayBillId: doc.ewayBillId,
            shippingNo: doc.shippingNo,
            deliveredDate: doc.deliveredDate,
            orderType: doc.orderType,
            remittanceDate: doc.remittanceDate,
            remittedAmount: doc.remittedAmount,
          },
          $setOnInsert: { orderNumber: doc.orderNumber },
        },
        upsert: true,
      },
    }));

    const result = await Remittance.bulkWrite(ops, { ordered: false });
    fs.unlink(req.file.path, () => {});

    return res.json({
      message: "CSV imported successfully",
      stats: {
        rowsRead: rows.length,
        uniqueRows: uniqueRows.length,
        inserted: result.upsertedCount || 0,
        modified: result.modifiedCount || 0,
        matched: result.matchedCount || 0,
        invalidRows: invalidRows.length,
      },
      invalidRows: invalidRows.slice(0, 100),
    });
  } catch (error) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return res.status(500).json({ message: "importRemittanceCsv error", error: error.message });
  }
};

/* exports */

export const exportRemittanceCsv = async (req, res) => {
  try {
    const filter = buildListQuery(req.query);
    const sort = buildSort(req.query.sortBy, req.query.sortOrder);

    const rows = await Remittance.find(filter)
      .select("ewayBillId shippingNo orderNumber deliveredDate orderType remittanceDate remittedAmount")
      .sort(sort)
      .lean();

    const header = [
      "eway bill id",
      "shipping no",
      "order number",
      "delivered date",
      "order type",
      "remittance date",
      "remitted amount",
    ];

    const csvLines = [
      header.join(","),
      ...rows.map((r) =>
        [
          `"${safe(r.ewayBillId).replace(/"/g, '""')}"`,
          `"${safe(r.shippingNo).replace(/"/g, '""')}"`,
          `"${safe(r.orderNumber).replace(/"/g, '""')}"`,
          `"${formatDate(r.deliveredDate)}"`,
          `"${safe(r.orderType).replace(/"/g, '""')}"`,
          `"${formatDate(r.remittanceDate)}"`,
          `"${r.remittedAmount ?? 0}"`,
        ].join(",")
      ),
    ];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=remittance_export_${Date.now()}.csv`);
    return res.send(csvLines.join("\n"));
  } catch (error) {
    return res.status(500).json({ message: "exportRemittanceCsv error", error: error.message });
  }
};

export const exportRemittanceExcel = async (req, res) => {
  try {
    const filter = buildListQuery(req.query);
    const sort = buildSort(req.query.sortBy, req.query.sortOrder);

    const rows = await Remittance.find(filter)
      .select("ewayBillId shippingNo orderNumber deliveredDate orderType remittanceDate remittedAmount createdAt")
      .sort(sort)
      .lean();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Remittance");

    sheet.columns = [
      { header: "Eway Bill ID", key: "ewayBillId", width: 22 },
      { header: "Shipping No", key: "shippingNo", width: 22 },
      { header: "Order Number", key: "orderNumber", width: 22 },
      { header: "Delivered Date", key: "deliveredDate", width: 18 },
      { header: "Order Type", key: "orderType", width: 18 },
      { header: "Remittance Date", key: "remittanceDate", width: 18 },
      { header: "Remitted Amount", key: "remittedAmount", width: 18 },
      { header: "Created At", key: "createdAt", width: 18 },
    ];

    rows.forEach((r) => {
      sheet.addRow({
        ewayBillId: safe(r.ewayBillId),
        shippingNo: safe(r.shippingNo),
        orderNumber: safe(r.orderNumber),
        deliveredDate: formatDate(r.deliveredDate),
        orderType: safe(r.orderType),
        remittanceDate: formatDate(r.remittanceDate),
        remittedAmount: r.remittedAmount ?? 0,
        createdAt: formatDate(r.createdAt),
      });
    });

    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: "H1" };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=remittance_export_${Date.now()}.xlsx`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    return res.status(500).json({ message: "exportRemittanceExcel error", error: error.message });
  }
};

/* pending */

export const getPendingRemittances = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const skip = (page - 1) * limit;
    const search = safe(req.query.search);
    const sortBy = req.query.sortBy || "deliveredDate";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

    const sortMap = {
      deliveredDate: { deliveredDate: sortOrder, createdAt: -1 },
      orderNumber: { orderNumber: sortOrder },
      finalPayable: { finalPayable: sortOrder },
      orderDate: { orderDate: sortOrder },
      paymentMethod: { paymentMethod: sortOrder, deliveredDate: -1 },
    };

    const basePipeline = getPendingBasePipeline(search);
    const sortStage = sortMap[sortBy] || sortMap.deliveredDate;

    const [countRows, rows] = await Promise.all([
      Order.aggregate([...basePipeline, { $count: "total" }]),
      Order.aggregate([
        ...basePipeline,
        {
          $project: {
            _id: 1,
            orderNumber: 1,
            orderDate: 1,
            finalPayable: 1,
            paymentStatus: 1,
            paymentMethod: 1,
            deliveredDate: 1,
            shippingNo: getShippingNoExpr(),
            remittanceExists: {
              $cond: [{ $ifNull: ["$remittanceDoc._id", false] }, true, false],
            },
            remittanceId: "$remittanceDoc._id",
            remittanceDate: "$remittanceDoc.remittanceDate",
            remittedAmount: "$remittanceDoc.remittedAmount",
            ewayBillId: "$remittanceDoc.ewayBillId",
            paymentModeLabel: {
              $switch: {
                branches: [
                  { case: { $eq: ["$paymentMethod", "cod"] }, then: "COD" },
                  { case: { $eq: ["$paymentMethod", "razorpay"] }, then: "Prepaid" },
                ],
                default: "-",
              },
            },
          },
        },
        { $sort: sortStage },
        { $skip: skip },
        { $limit: limit },
      ]),
    ]);

    const totalCount = countRows[0]?.total || 0;
    const totalPages = Math.ceil(totalCount / limit) || 1;

    return res.json({
      message: "Pending remittances fetched successfully",
      data: rows,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "getPendingRemittances error", error: error.message });
  }
};

export const exportPendingRemittancesCsv = async (req, res) => {
  try {
    const search = safe(req.query.search);
    const sortBy = req.query.sortBy || "deliveredDate";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

    const sortMap = {
      deliveredDate: { deliveredDate: sortOrder, createdAt: -1 },
      orderNumber: { orderNumber: sortOrder },
      finalPayable: { finalPayable: sortOrder },
      orderDate: { orderDate: sortOrder },
      paymentMethod: { paymentMethod: sortOrder, deliveredDate: -1 },
    };

    const rows = await Order.aggregate([
      ...getPendingBasePipeline(search),
      {
        $project: {
          _id: 0,
          ewayBillId: "",
          shippingNo: getShippingNoExpr(),
          orderNumber: 1,
          deliveredDate: 1,
          orderType: {
            $switch: {
              branches: [
                { case: { $eq: ["$paymentMethod", "cod"] }, then: "cod" },
                { case: { $eq: ["$paymentMethod", "razorpay"] }, then: "razorpay" },
              ],
              default: "",
            },
          },
          remittanceDate: "",
          remittedAmount: { $ifNull: ["$finalPayable", 0] },
        },
      },
      { $sort: sortMap[sortBy] || sortMap.deliveredDate },
    ]);

    const header = [
      "eway bill id",
      "shipping no",
      "order number",
      "delivered date",
      "order type",
      "remittance date",
      "remitted amount",
    ];

    const csvLines = [
      header.join(","),
      ...rows.map((r) =>
        [
          `"${safe(r.ewayBillId).replace(/"/g, '""')}"`,
          `"${safe(r.shippingNo).replace(/"/g, '""')}"`,
          `"${safe(r.orderNumber).replace(/"/g, '""')}"`,
          `"${formatDate(r.deliveredDate)}"`,
          `"${safe(r.orderType).replace(/"/g, '""')}"`,
          `"${safe(r.remittanceDate).replace(/"/g, '""')}"`,
          `"${r.remittedAmount ?? 0}"`,
        ].join(",")
      ),
    ];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=pending_remittance_${Date.now()}.csv`);
    return res.send(csvLines.join("\n"));
  } catch (error) {
    return res.status(500).json({ message: "exportPendingRemittancesCsv error", error: error.message });
  }
};

/* summary */

export const getRemittanceSummary = async (req, res) => {
  try {
    const [summary] = await Remittance.aggregate([
      {
        $group: {
          _id: null,
          totalEntries: { $sum: 1 },
          totalRemittedAmount: { $sum: "$remittedAmount" },
          latestRemittanceDate: { $max: "$remittanceDate" },
        },
      },
    ]);

    const [pending] = await Order.aggregate([
      ...getPendingBasePipeline(""),
      { $count: "pendingCount" },
    ]);

    return res.json({
      message: "Remittance summary fetched successfully",
      data: {
        totalEntries: summary?.totalEntries || 0,
        totalRemittedAmount: summary?.totalRemittedAmount || 0,
        latestRemittanceDate: summary?.latestRemittanceDate || null,
        pendingCount: pending?.pendingCount || 0,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "getRemittanceSummary error", error: error.message });
  }
};