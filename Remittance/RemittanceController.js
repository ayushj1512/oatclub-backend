import fs from "fs";
import csv from "csv-parser";
import ExcelJS from "exceljs";
import crypto from "crypto";

import Remittance from "./Remittance.js";
import Order from "../Orders/Orders.js";

import parseRazorpayReport from "./helpers/parseRazorpayReport.js";
import parseDelhiveryReport from "./helpers/parseDelhiveryReport.js";
import parseShiprocketReport from "./helpers/parseShiprocketReport.js";

import normalizeRemittanceRow from "./helpers/normalizeRemittanceRow.js";
import matchRemittanceOrder from "./helpers/matchRemittanceOrder.js";
import calculateRemittanceStatus from "./helpers/calculateRemittanceStatus.js";

/* helpers */

const safe = (v) => String(v ?? "").trim();
const normalizeOrderNumber = (v) => safe(v).toUpperCase();
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeOrderType = (value) => {
  const v = safe(value)
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (v === "cod") {
    return "cod";
  }

  if (
    v === "razorpay" ||
    v === "prepaid" ||
    v === "online"
  ) {
    return "razorpay";
  }

  if (v === "partial_cod") {
    return "partial_cod";
  }

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
    source = "",
    reconciliationStatus = "",
    requiresReview = "",
    isRemitted = "",
  } = query;

  const q = {};

  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    q.$or = [
      { orderNumber: rx },
      { ewayBillId: rx },
      { shippingNo: rx },
      { orderType: rx },
      { source: rx },
      { providerReference: rx },
      { utr: rx },
      { reconciliationStatus: rx },
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

  if (source) {
    q.source =
      normalizeImportSource(source);
  }

  if (reconciliationStatus) {
    q.reconciliationStatus =
      safe(
        reconciliationStatus
      ).toLowerCase();
  }

  if (
    requiresReview === "true" ||
    requiresReview === true
  ) {
    q.requiresReview = true;
  }

  if (
    requiresReview === "false" ||
    requiresReview === false
  ) {
    q.requiresReview = false;
  }

  if (
    isRemitted === "true" ||
    isRemitted === true
  ) {
    q.isRemitted = true;
  }

  if (
    isRemitted === "false" ||
    isRemitted === false
  ) {
    q.isRemitted = false;
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
    "source",
    "expectedAmount",
    "receivedAmount",
    "differenceAmount",
    "reconciliationStatus",
    "isRemitted",
    "requiresReview",
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
        {
          $ifNull: [
            "$shipment.delhivery.awb",
            {
              $ifNull: [
                "$shipment.awb",
                "$trackingDetails.trackingId",
              ],
            },
          ],
        },
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
    {
      $match: {
        $or: [
          /*
           * No remittance record exists.
           */
          {
            remittanceDoc: {
              $eq: null,
            },
          },

          /*
           * New reconciliation record exists
           * but is not fully remitted.
           */
          {
            "remittanceDoc.isRemitted":
              false,
          },

          /*
           * Backward compatibility for old
           * remittance records created before
           * isRemitted was introduced.
           */
          {
            $and: [
              {
                "remittanceDoc.isRemitted": {
                  $exists: false,
                },
              },
              {
                $or: [
                  {
                    "remittanceDoc.remittanceDate": {
                      $eq: null,
                    },
                  },
                  {
                    "remittanceDoc.remittedAmount": {
                      $lte: 0,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
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

const REMITTANCE_IMPORT_SOURCES = {
  manual: {
    value: "manual",
    label: "Manual Entry",
    enabled: true,
    requiresFile: false,
    acceptedFormats: [],
  },

  razorpay: {
    value: "razorpay",
    label: "Razorpay",
    enabled: false,
    requiresFile: true,
    acceptedFormats: [
      ".csv",
      ".xls",
      ".xlsx",
    ],
    disabledReason:
      "Order-wise Razorpay report is not configured",
  },

  delhivery: {
    value: "delhivery",
    label: "Delhivery",
    enabled: true,
    requiresFile: true,
    acceptedFormats: [".csv"],
  },

  shiprocket: {
    value: "shiprocket",
    label: "Shiprocket",
    enabled: true,
    requiresFile: true,
    acceptedFormats: [
      ".xls",
      ".xlsx",
    ],
  },
};

const REMITTANCE_PARSERS = {
  razorpay: parseRazorpayReport,
  delhivery: parseDelhiveryReport,
  shiprocket: parseShiprocketReport,
};

const normalizeImportSource = (
  value
) =>
  String(value || "")
    .trim()
    .toLowerCase();

const removeUploadedFile = (
  filePath
) => {
  if (!filePath) return;

  fs.unlink(filePath, (error) => {
    if (
      error &&
      error.code !== "ENOENT"
    ) {
      console.error(
        "Failed to remove remittance upload:",
        error.message
      );
    }
  });
};

const REMITTANCE_SELECT_FIELDS = [
  "ewayBillId",
  "shippingNo",
  "orderNumber",
  "deliveredDate",
  "orderType",
  "remittanceDate",
  "remittedAmount",

  "source",
  "reportType",
  "providerReference",
  "utr",

  "expectedAmount",
  "receivedAmount",
  "differenceAmount",
  "adjustedAmount",

  "reconciliationStatus",
  "isRemitted",
  "requiresReview",

  "matchedOrderId",
  "matchType",

  "importBatchId",
  "importRowNumber",

  "createdAt",
  "updatedAt",
].join(" ");

/* CRUD */

export const createRemittance = async (
  req,
  res
) => {
  try {
    let orderNumber =
      normalizeOrderNumber(
        req.body.orderNumber
      );

    const shippingNo = safe(
      req.body.shippingNo
    ).replace(/\.0+$/, "");

    if (!orderNumber) {
      return res.status(400).json({
        success: false,
        code:
          "ORDER_NUMBER_REQUIRED",
        message:
          "orderNumber is required",
      });
    }

    /*
     * Manual remittance must match an
     * existing OATCLUB order.
     */
    const matchResult =
      await matchRemittanceOrder({
        orderNumber,
        shippingNo,
      });

    if (!matchResult.matched) {
      return res.status(404).json({
        success: false,
        code: "ORDER_NOT_FOUND",
        message:
          "No matching order found for this order number or shipping number",
      });
    }

    orderNumber =
      matchResult.orderNumber ||
      orderNumber;

    const exists =
      await Remittance.findOne({
        orderNumber,
      })
        .select(
          "_id orderNumber source reconciliationStatus isRemitted"
        )
        .lean();

    if (exists) {
      return res.status(409).json({
        success: false,
        code:
          "REMITTANCE_ALREADY_EXISTS",
        message:
          "Remittance already exists for this orderNumber",
        data: exists,
      });
    }

    const receivedAmount =
      parseAmount(
        req.body.receivedAmount ??
        req.body.remittedAmount
      );

    /*
     * If expected amount is not manually
     * entered, use received amount.
     *
     * This keeps the existing manual form
     * compatible.
     */
    const expectedAmount =
      req.body.expectedAmount !==
        undefined &&
        req.body.expectedAmount !== ""
        ? parseAmount(
          req.body.expectedAmount
        )
        : receivedAmount;

    const differenceAmount =
      Number(
        (
          receivedAmount -
          expectedAmount
        ).toFixed(2)
      );

    let reconciliationStatus =
      "pending";

    let isRemitted = false;
    let requiresReview = false;

    if (
      receivedAmount > 0 &&
      Math.abs(differenceAmount) <= 1
    ) {
      reconciliationStatus =
        "fully_remitted";

      isRemitted = true;
    } else if (
      receivedAmount > 0 &&
      receivedAmount <
      expectedAmount
    ) {
      reconciliationStatus =
        "partially_remitted";

      requiresReview = true;
    } else if (
      receivedAmount >
      expectedAmount
    ) {
      reconciliationStatus =
        "excess_remitted";

      requiresReview = true;
    }

    const payload = {
      ewayBillId: safe(
        req.body.ewayBillId
      ),

      shippingNo,

      orderNumber,

      deliveredDate: parseDate(
        req.body.deliveredDate
      ),

      orderType:
        normalizeOrderType(
          req.body.orderType ||
          matchResult.order
            ?.paymentMethod
        ),

      remittanceDate:
        parseDate(
          req.body.remittanceDate
        ) || new Date(),

      remittedAmount:
        receivedAmount,

      source: "manual",

      reportType:
        "manual_entry",

      providerReference: safe(
        req.body.providerReference
      ),

      utr: safe(req.body.utr),

      expectedAmount,

      receivedAmount,

      differenceAmount,

      adjustedAmount: 0,

      reconciliationStatus,

      isRemitted,

      requiresReview,

      matchedOrderId:
        matchResult.orderId,

      matchType:
        matchResult.matchType,

      importBatchId: `manual-${crypto.randomUUID()}`,

      importRowNumber: null,

      rawRow: {
        enteredManually: true,

        note: safe(
          req.body.note
        ),
      },
    };

    const doc =
      await Remittance.create(
        payload
      );

    return res
      .status(201)
      .json({
        success: true,

        message:
          "Manual remittance created successfully",

        data: doc,
      });
  } catch (error) {
    console.error(
      "createRemittance error:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,

        code:
          "CREATE_REMITTANCE_FAILED",

        message:
          "Failed to create remittance",

        error: error.message,
      });
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
        .select(
          REMITTANCE_SELECT_FIELDS
        )
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
    const doc =
      await Remittance.findById(
        req.params.id
      )
        .select(
          `${REMITTANCE_SELECT_FIELDS} rawRow`
        )
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
            remittanceSource:
              "$remittanceDoc.source",

            reconciliationStatus:
              "$remittanceDoc.reconciliationStatus",

            isRemitted: {
              $ifNull: [
                "$remittanceDoc.isRemitted",
                false,
              ],
            },

            requiresReview: {
              $ifNull: [
                "$remittanceDoc.requiresReview",
                false,
              ],
            },

            expectedAmount: {
              $ifNull: [
                "$remittanceDoc.expectedAmount",
                "$finalPayable",
              ],
            },

            differenceAmount: {
              $ifNull: [
                "$remittanceDoc.differenceAmount",
                0,
              ],
            },

            utr:
              "$remittanceDoc.utr",

            providerReference:
              "$remittanceDoc.providerReference",
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


export const getRemittanceImportSources = async (
  _req,
  res
) => {
  return res.status(200).json({
    success: true,

    data: Object.values(
      REMITTANCE_IMPORT_SOURCES
    ),
  });
};

export const importRemittanceReport = async (
  req,
  res
) => {
  const uploadedFilePath =
    req.file?.path || "";

  try {
    const source =
      normalizeImportSource(
        req.body?.source
      );

    if (!source) {
      return res.status(400).json({
        success: false,
        code:
          "REMITTANCE_SOURCE_REQUIRED",
        message:
          "Please select a remittance source",
      });
    }

    const sourceConfig =
      REMITTANCE_IMPORT_SOURCES[
      source
      ];

    if (!sourceConfig) {
      return res.status(400).json({
        success: false,
        code:
          "INVALID_REMITTANCE_SOURCE",
        message:
          "Invalid remittance source",
        allowedSources:
          Object.keys(
            REMITTANCE_IMPORT_SOURCES
          ),
      });
    }

    /*
     * Manual entry uses existing
     * POST /api/remittance endpoint.
     */
    if (source === "manual") {
      return res.status(400).json({
        success: false,
        code:
          "USE_MANUAL_REMITTANCE_ENDPOINT",
        message:
          "Use POST /api/remittance for manual entries",
      });
    }

    if (!sourceConfig.enabled) {
      return res.status(400).json({
        success: false,
        code:
          `${source.toUpperCase()}_IMPORT_DISABLED`,
        message:
          sourceConfig.disabledReason ||
          `${sourceConfig.label} import is disabled`,
      });
    }

    if (!req.file?.path) {
      return res.status(400).json({
        success: false,
        code:
          "REMITTANCE_FILE_REQUIRED",
        message:
          `${sourceConfig.label} report file is required`,
      });
    }

    const parser =
      REMITTANCE_PARSERS[source];

    if (!parser) {
      return res.status(400).json({
        success: false,
        code:
          "REMITTANCE_PARSER_NOT_FOUND",
        message:
          `Parser is not configured for ${source}`,
      });
    }

    /*
     * Parse provider-specific report.
     */
    const parsedReport =
      await parser(
        req.file.path
      );

    if (
      !Array.isArray(
        parsedReport?.rows
      ) ||
      !parsedReport.rows.length
    ) {
      return res.status(400).json({
        success: false,
        code:
          "NO_VALID_REMITTANCE_ROWS",
        message:
          "No valid remittance rows found in uploaded report",
        parserStats:
          parsedReport?.stats || {},
      });
    }

    const importBatchId =
      crypto.randomUUID();

    const processedRows = [];
    const duplicateRows = [];
    const failedRows = [];

    for (
      const parserRow of
      parsedReport.rows
    ) {
      try {
        /*
         * Convert provider row into
         * common format.
         */
        const normalizedRow =
          normalizeRemittanceRow(
            parserRow
          );

        /*
         * Match against Orders.
         */
        const matchResult =
          await matchRemittanceOrder(
            normalizedRow
          );

        if (
          matchResult.matched &&
          matchResult.orderNumber
        ) {
          normalizedRow.orderNumber =
            matchResult.orderNumber;
        }

        /*
         * Detect an already imported
         * provider transaction.
         */
        const duplicateQuery = {
          source,
          providerReference:
            normalizedRow.providerReference,
          orderNumber:
            normalizedRow.orderNumber,
        };

        const existingTransaction =
          normalizedRow.providerReference
            ? await Remittance.findOne(
              duplicateQuery
            )
              .select(
                "_id orderNumber source providerReference isRemitted reconciliationStatus"
              )
              .lean()
            : null;

        if (existingTransaction) {
          duplicateRows.push({
            rowNumber:
              normalizedRow.importRowNumber,

            orderNumber:
              normalizedRow.orderNumber,

            shippingNo:
              normalizedRow.shippingNo,

            providerReference:
              normalizedRow.providerReference,

            existingRemittanceId:
              existingTransaction._id,

            reason:
              "This provider transaction was already imported",
          });

          continue;
        }

        const statusResult =
          calculateRemittanceStatus({
            row: normalizedRow,

            order:
              matchResult.order,

            matched:
              matchResult.matched,

            duplicate: false,

            tolerance: 1,
          });

        if (
          !normalizedRow.orderNumber
        ) {
          failedRows.push({
            rowNumber:
              normalizedRow.importRowNumber,

            orderNumber: "",

            shippingNo:
              normalizedRow.shippingNo,

            reason:
              "Normalized Order Number is missing",
          });

          continue;
        }

        const remittanceData = {
          ewayBillId:
            normalizedRow.ewayBillId,

          shippingNo:
            normalizedRow.shippingNo,

          orderNumber:
            normalizedRow.orderNumber,

          deliveredDate:
            normalizedRow.deliveredDate,

          orderType:
            normalizedRow.orderType,

          remittanceDate:
            normalizedRow.remittanceDate,

          remittedAmount:
            statusResult.receivedAmount ??
            normalizedRow.remittedAmount,

          source,

          reportType:
            normalizedRow.reportType,

          providerReference:
            normalizedRow.providerReference,

          utr:
            normalizedRow.utr,

          expectedAmount:
            statusResult.expectedAmount ??
            normalizedRow.expectedAmount,

          receivedAmount:
            statusResult.receivedAmount ??
            normalizedRow.receivedAmount,

          differenceAmount:
            statusResult.differenceAmount ??
            normalizedRow.differenceAmount,

          adjustedAmount:
            normalizedRow.adjustedAmount,

          reconciliationStatus:
            statusResult.status,

          isRemitted:
            Boolean(
              statusResult.isRemitted
            ),

          requiresReview:
            Boolean(
              statusResult.requiresReview
            ),

          matchedOrderId:
            matchResult.orderId || null,

          matchType:
            matchResult.matchType || "",

          importBatchId,

          importRowNumber:
            normalizedRow.importRowNumber,

          rawRow:
            normalizedRow.rawRow,
        };

        /*
         * One current reconciliation
         * record per order.
         *
         * Existing pending/manual rows
         * will get upgraded with the
         * provider report information.
         */
        const savedRemittance =
          await Remittance.findOneAndUpdate(
            {
              orderNumber:
                normalizedRow.orderNumber,
            },
            {
              $set: remittanceData,
            },
            {
              new: true,
              upsert: true,
              runValidators: true,
              setDefaultsOnInsert: true,
            }
          ).lean();

        processedRows.push({
          remittanceId:
            savedRemittance._id,

          rowNumber:
            normalizedRow.importRowNumber,

          orderNumber:
            normalizedRow.orderNumber,

          shippingNo:
            normalizedRow.shippingNo,

          status:
            statusResult.status,

          isRemitted:
            statusResult.isRemitted,

          requiresReview:
            statusResult.requiresReview,

          expectedAmount:
            statusResult.expectedAmount,

          receivedAmount:
            statusResult.receivedAmount,

          differenceAmount:
            statusResult.differenceAmount,

          matchType:
            matchResult.matchType,

          reason:
            statusResult.reason,
        });
      } catch (rowError) {
        failedRows.push({
          rowNumber:
            parserRow?.importRowNumber ||
            null,

          orderNumber:
            parserRow?.orderNumber ||
            "",

          shippingNo:
            parserRow?.shippingNo ||
            parserRow?.awb ||
            "",

          reason:
            rowError.message,
        });
      }
    }

    const countStatus = (
      status
    ) =>
      processedRows.filter(
        (row) =>
          row.status === status
      ).length;

    return res.status(200).json({
      success: true,

      message:
        `${sourceConfig.label} report processed successfully`,

      data: {
        source,

        importBatchId,

        fileName:
          req.file.originalname,

        importedAt:
          new Date(),

        stats: {
          parserRows:
            parsedReport.rows.length,

          processedRows:
            processedRows.length,

          fullyRemitted:
            countStatus(
              "fully_remitted"
            ),

          partiallyRemitted:
            countStatus(
              "partially_remitted"
            ),

          excessRemitted:
            countStatus(
              "excess_remitted"
            ),

          amountAdjusted:
            countStatus(
              "amount_adjusted"
            ),

          needsReview:
            processedRows.filter(
              (row) =>
                row.requiresReview
            ).length,

          unmapped:
            countStatus("unmapped"),

          duplicates:
            duplicateRows.length,

          failedRows:
            failedRows.length,

          parserInvalidRows:
            parsedReport
              .invalidRows?.length || 0,

          parserDuplicateRows:
            parsedReport
              .duplicateRows?.length || 0,
        },

        providerStats:
          parsedReport.stats || {},

        batchSummaries:
          parsedReport.batchSummaries ||
          [],

        processedRows,

        duplicateRows,

        failedRows,

        invalidRows:
          parsedReport.invalidRows ||
          [],

        parserDuplicateRows:
          parsedReport.duplicateRows ||
          [],
      },
    });
  } catch (error) {
    console.error(
      "Remittance report import error:",
      error
    );

    return res
      .status(
        error.statusCode || 500
      )
      .json({
        success: false,

        code:
          error.code ||
          "REMITTANCE_IMPORT_FAILED",

        message:
          error.message ||
          "Failed to import remittance report",
      });
  } finally {
    removeUploadedFile(
      uploadedFilePath
    );
  }
};
