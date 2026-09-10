import fs from "fs";
import XLSXPackage from "xlsx";

const XLSX =
  XLSXPackage?.default ||
  XLSXPackage;

const AWB_SHEET_NAME =
  "AWB level report";

const CRF_SHEET_NAME =
  "CRF level report";

const REQUIRED_AWB_HEADERS = [
  "crf_id",
  "awb",
  "delivered_date",
  "shipped_date",
  "order_id",
  "courier",
  "order_value",
  "channel_name",
  "remittance_date",
  "utr",
  "total_adjusted_amt",
  "linked_crf_ids",
];

const REQUIRED_CRF_HEADERS = [
  "date",
  "crf_id",
  "cod_available",
  "freight_charges_from_cod",
  "early_cod_charges",
  "rto_reversal_amount",
  "remittance_amount",
  "remittance_method",
  "utr",
  "adjusted_amount",
  "status",
  "remarks",
];

const clean = (value) =>
  String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim();

const normalizeHeader = (value) =>
  clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeOrderNumber = (value) =>
  clean(value).toUpperCase();

const parseAmount = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  const cleaned = String(value).replace(
    /[₹,\s]/g,
    ""
  );

  const amount = Number(cleaned);

  return Number.isFinite(amount)
    ? amount
    : null;
};

/**
 * Shiprocket dates in this report:
 * 2026-09-09 02:05:51
 *
 * Treat them as IST and store as UTC.
 */
const parseShiprocketDate = (value) => {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value;
  }

  const text = clean(value);

  const match = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
  );

  if (match) {
    const [
      ,
      year,
      month,
      day,
      hour = "0",
      minute = "0",
      second = "0",
    ] = match;

    const utcTime =
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
      ) -
      5.5 * 60 * 60 * 1000;

    const date = new Date(utcTime);

    return Number.isNaN(date.getTime())
      ? null
      : date;
  }

  const fallback = new Date(text);

  return Number.isNaN(fallback.getTime())
    ? null
    : fallback;
};

const normalizeStatus = (value) =>
  clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const readSheetRows = (
  workbook,
  sheetName
) => {
  const worksheet =
    workbook.Sheets[sheetName];

  if (!worksheet) {
    throw new Error(
      `Shiprocket sheet not found: ${sheetName}`
    );
  }

  const rows = XLSX.utils.sheet_to_json(
    worksheet,
    {
      defval: "",
      raw: false,
      blankrows: false,
    }
  );

  return rows.map((rawRow) => {
    const normalizedRow = {};

    Object.entries(rawRow).forEach(
      ([header, value]) => {
        normalizedRow[
          normalizeHeader(header)
        ] = value;
      }
    );

    return normalizedRow;
  });
};

const validateHeaders = (
  rows,
  requiredHeaders,
  sheetName
) => {
  if (!rows.length) {
    throw new Error(
      `${sheetName} does not contain any rows`
    );
  }

  const detectedHeaders =
    Object.keys(rows[0]);

  const missingHeaders =
    requiredHeaders.filter(
      (header) =>
        !detectedHeaders.includes(header)
    );

  if (missingHeaders.length) {
    throw new Error(
      `Invalid ${sheetName}. Missing columns: ${missingHeaders.join(
        ", "
      )}`
    );
  }
};

const normalizeCrfId = (value) => {
  const text = clean(value);

  // Handles values like 13438950.0
  if (/^\d+\.0+$/.test(text)) {
    return text.split(".")[0];
  }

  return text;
};

const parseCrfSheet = (rows) => {
  const crfMap = new Map();
  const invalidRows = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;

    const crfId =
      normalizeCrfId(row.crf_id);

    if (!crfId) {
      invalidRows.push({
        rowNumber,
        reason: "CRF ID is missing",
        rawRow: row,
      });

      return;
    }

    const codAvailable = parseAmount(
      row.cod_available
    );

    const freightCharges =
      parseAmount(
        row.freight_charges_from_cod
      );

    const earlyCodCharges =
      parseAmount(
        row.early_cod_charges
      );

    const rtoReversalAmount =
      parseAmount(
        row.rto_reversal_amount
      );

    const remittanceAmount =
      parseAmount(
        row.remittance_amount
      );

    const adjustedAmount =
      parseAmount(
        row.adjusted_amount
      );

    const numericValues = [
      codAvailable,
      freightCharges,
      earlyCodCharges,
      rtoReversalAmount,
      remittanceAmount,
      adjustedAmount,
    ];

    if (
      numericValues.some(
        (value) => value === null
      )
    ) {
      invalidRows.push({
        rowNumber,
        crfId,
        reason:
          "One or more CRF amount fields are invalid",
        rawRow: row,
      });

      return;
    }

    crfMap.set(crfId, {
      crfId,

      remittanceDate:
        parseShiprocketDate(row.date),

      codAvailable,

      freightCharges,

      earlyCodCharges,

      rtoReversalAmount,

      remittanceAmount,

      remittanceMethod: clean(
        row.remittance_method
      ),

      utr: clean(row.utr),

      adjustedAmount,

      status: normalizeStatus(
        row.status
      ),

      remarks: clean(row.remarks),

      rawRow: row,
    });
  });

  return {
    crfMap,
    invalidRows,
  };
};

export default async function parseShiprocketReport(
  filePath
) {
  if (!filePath) {
    throw new Error(
      "Shiprocket report file path is required"
    );
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(
      "Shiprocket report file not found"
    );
  }

  let workbook;

  try {
    workbook = XLSX.readFile(filePath, {
      raw: false,
      cellDates: false,

      /*
       * Keeps parsing tolerant because some
       * Shiprocket .xls exports contain minor
       * workbook metadata corruption.
       */
      WTF: false,
    });
  } catch (error) {
    throw new Error(
      `Unable to read Shiprocket XLS report: ${error.message}`
    );
  }

  const awbRows = readSheetRows(
    workbook,
    AWB_SHEET_NAME
  );

  const crfRows = readSheetRows(
    workbook,
    CRF_SHEET_NAME
  );

  validateHeaders(
    awbRows,
    REQUIRED_AWB_HEADERS,
    AWB_SHEET_NAME
  );

  validateHeaders(
    crfRows,
    REQUIRED_CRF_HEADERS,
    CRF_SHEET_NAME
  );

  const {
    crfMap,
    invalidRows: invalidCrfRows,
  } = parseCrfSheet(crfRows);

  const rows = [];
  const invalidRows = [
    ...invalidCrfRows.map((row) => ({
      sheet: CRF_SHEET_NAME,
      ...row,
    })),
  ];

  const duplicateRows = [];
  const seenKeys = new Set();

  awbRows.forEach((rawRow, index) => {
    const rowNumber = index + 2;

    const crfId = normalizeCrfId(
      rawRow.crf_id
    );

    /*
     * AWB may be numeric in Excel.
     * Always convert it to a string.
     */
    const shippingNo = clean(
      rawRow.awb
    ).replace(/\.0+$/, "");

    /*
     * Confirmed mapping:
     * Shiprocket Order Id = OATCLUB orderNumber
     */
    const orderNumber =
      normalizeOrderNumber(
        rawRow.order_id
      );

    const orderValue = parseAmount(
      rawRow.order_value
    );

    const adjustedAmount =
      parseAmount(
        rawRow.total_adjusted_amt
      );

    const errors = [];

    if (!crfId) {
      errors.push("CRF ID is missing");
    }

    if (!shippingNo) {
      errors.push("AWB is missing");
    }

    if (!orderNumber) {
      errors.push("Order Id is missing");
    }

    if (orderValue === null) {
      errors.push(
        "Order Value is invalid"
      );
    }

    if (adjustedAmount === null) {
      errors.push(
        "Adjusted Amount is invalid"
      );
    }

    const deliveredDate =
      parseShiprocketDate(
        rawRow.delivered_date
      );

    const remittanceDate =
      parseShiprocketDate(
        rawRow.remittance_date
      );

    if (!deliveredDate) {
      errors.push(
        "Delivered Date is invalid"
      );
    }

    if (!remittanceDate) {
      errors.push(
        "Remittance Date is invalid"
      );
    }

    const crfSummary =
      crfMap.get(crfId);

    if (!crfSummary) {
      errors.push(
        `CRF summary not found for ${crfId}`
      );
    }

    if (errors.length) {
      invalidRows.push({
        sheet: AWB_SHEET_NAME,
        rowNumber,
        orderNumber,
        shippingNo,
        crfId,
        reasons: errors,
        rawRow,
      });

      return;
    }

    const uniqueKey =
      `${crfId}::${shippingNo}::${orderNumber}`;

    if (seenKeys.has(uniqueKey)) {
      duplicateRows.push({
        sheet: AWB_SHEET_NAME,
        rowNumber,
        orderNumber,
        shippingNo,
        crfId,
        reason:
          "Duplicate CRF, AWB and Order Id combination",
        rawRow,
      });

      return;
    }

    seenKeys.add(uniqueKey);

    const remittedAmount = Number(
      (
        orderValue -
        adjustedAmount
      ).toFixed(2)
    );

    const differenceAmount = Number(
      (
        remittedAmount -
        orderValue
      ).toFixed(2)
    );

    const remittanceSuccessful =
      crfSummary.status ===
      "remittance_success" &&
      Boolean(crfSummary.utr) &&
      Boolean(remittanceDate);

    let reconciliationStatus;

    if (!remittanceSuccessful) {
      reconciliationStatus =
        "needs_review";
    } else if (
      Math.abs(differenceAmount) <=
      0.01
    ) {
      reconciliationStatus =
        "remitted";
    } else {
      reconciliationStatus =
        "amount_adjusted";
    }

    rows.push({
      source: "shiprocket",

      reportType:
        "cod_remittance",

      recordType:
        "cod_remittance",

      /*
       * OATCLUB matching fields
       */
      orderNumber,

      shippingNo,

      awb: shippingNo,

      /*
       * Shiprocket remittance identifiers
       */
      crfId,

      providerReference: crfId,

      utr:
        clean(rawRow.utr) ||
        crfSummary.utr,

      linkedCrfIds: clean(
        rawRow.linked_crf_ids
      ),

      /*
       * Shipment information
       */
      courier: clean(
        rawRow.courier
      ),

      channelName: clean(
        rawRow.channel_name
      ),

      shippedDate:
        parseShiprocketDate(
          rawRow.shipped_date
        ),

      deliveredDate,

      remittanceDate,

      /*
       * Amount information
       */
      expectedAmount: orderValue,

      receivedAmount:
        remittedAmount,

      orderValue,

      adjustedAmount,

      remittedAmount,

      differenceAmount,

      paymentMode: "cod",

      orderType: "cod",

      /*
       * Batch verification
       */
      crfStatus:
        crfSummary.status,

      crfRemarks:
        crfSummary.remarks,

      crfCodAvailable:
        crfSummary.codAvailable,

      crfRemittanceAmount:
        crfSummary.remittanceAmount,

      crfFreightCharges:
        crfSummary.freightCharges,

      crfEarlyCodCharges:
        crfSummary.earlyCodCharges,

      crfRtoReversalAmount:
        crfSummary.rtoReversalAmount,

      crfAdjustedAmount:
        crfSummary.adjustedAmount,

      reconciliationStatus,

      importRowNumber:
        rowNumber,

      rawRow,
    });
  });

  if (!rows.length) {
    throw new Error(
      "No valid Shiprocket remittance rows found"
    );
  }

  /*
   * Verify each CRF batch independently.
   */
  const batchSummaries = [];

  crfMap.forEach(
    (crfSummary, crfId) => {
      const batchRows = rows.filter(
        (row) =>
          row.crfId === crfId
      );

      const calculatedAmount =
        batchRows.reduce(
          (total, row) =>
            total +
            row.remittedAmount,
          0
        );

      const difference = Number(
        (
          calculatedAmount -
          crfSummary.remittanceAmount
        ).toFixed(2)
      );

      batchSummaries.push({
        crfId,

        utr: crfSummary.utr,

        status: crfSummary.status,

        remittanceDate:
          crfSummary.remittanceDate,

        orderCount:
          batchRows.length,

        calculatedAmount:
          Number(
            calculatedAmount.toFixed(2)
          ),

        reportedRemittanceAmount:
          crfSummary.remittanceAmount,

        difference,

        isMatched:
          Math.abs(difference) <=
          0.01,
      });
    }
  );

  const totalOrderValue =
    rows.reduce(
      (total, row) =>
        total + row.orderValue,
      0
    );

  const totalRemittedAmount =
    rows.reduce(
      (total, row) =>
        total + row.remittedAmount,
      0
    );

  return {
    source: "shiprocket",

    reportType:
      "cod_remittance",

    rows,

    batchSummaries,

    invalidRows,

    duplicateRows,

    stats: {
      rowsRead:
        rows.length +
        invalidRows.filter(
          (row) =>
            row.sheet ===
            AWB_SHEET_NAME
        ).length +
        duplicateRows.length,

      validRows: rows.length,

      invalidRows:
        invalidRows.length,

      duplicateRows:
        duplicateRows.length,

      remittedRows:
        rows.filter(
          (row) =>
            row.reconciliationStatus ===
            "remitted"
        ).length,

      adjustedRows:
        rows.filter(
          (row) =>
            row.reconciliationStatus ===
            "amount_adjusted"
        ).length,

      reviewRows:
        rows.filter(
          (row) =>
            row.reconciliationStatus ===
            "needs_review"
        ).length,

      totalOrderValue:
        Number(
          totalOrderValue.toFixed(2)
        ),

      totalRemittedAmount:
        Number(
          totalRemittedAmount.toFixed(2)
        ),

      batchCount:
        batchSummaries.length,

      matchedBatches:
        batchSummaries.filter(
          (batch) =>
            batch.isMatched
        ).length,

      mismatchedBatches:
        batchSummaries.filter(
          (batch) =>
            !batch.isMatched
        ).length,
    },
  };
}
