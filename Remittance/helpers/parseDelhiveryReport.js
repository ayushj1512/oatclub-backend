import fs from "fs";
import csv from "csv-parser";

const REQUIRED_HEADERS = [
  "description",
  "payment_mode",
  "client",
  "pincode",
  "amount_payable",
  "city",
  "status",
  "cod_amount",
  "waybill_number",
  "order_number",
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

const normalizePaymentMode = (value) => {
  const mode = clean(value).toLowerCase();

  if (mode === "cod") return "cod";

  if (
    mode === "prepaid" ||
    mode === "online"
  ) {
    return "prepaid";
  }

  return mode;
};

const normalizeStatus = (value) =>
  clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

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

const createRowKey = ({
  orderNumber,
  shippingNo,
}) =>
  `${orderNumber}::${shippingNo}`;

/**
 * Parses a Delhivery remittance-transactions CSV.
 *
 * @param {string} filePath
 * @returns {Promise<{
 *   source: string,
 *   reportType: string,
 *   rows: Array,
 *   invalidRows: Array,
 *   duplicateRows: Array,
 *   stats: Object
 * }>}
 */
export default async function parseDelhiveryReport(
  filePath
) {
  if (!filePath) {
    throw new Error(
      "Delhivery report file path is required"
    );
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(
      "Delhivery report file not found"
    );
  }

  const rows = [];
  const invalidRows = [];
  const duplicateRows = [];

  const seenKeys = new Set();

  let detectedHeaders = [];
  let rowNumber = 1;

  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(
        csv({
          mapHeaders: ({ header }) =>
            normalizeHeader(header),
        })
      )
      .on("headers", (headers) => {
        detectedHeaders = headers.map(
          normalizeHeader
        );
      })
      .on("data", (rawRow) => {
        rowNumber += 1;

        const orderNumber =
          normalizeOrderNumber(
            rawRow.order_number
          );

        const shippingNo = clean(
          rawRow.waybill_number
        );

        const paymentMode =
          normalizePaymentMode(
            rawRow.payment_mode
          );

        const deliveryStatus =
          normalizeStatus(rawRow.status);

        const codAmount = parseAmount(
          rawRow.cod_amount
        );

        const amountPayable = parseAmount(
          rawRow.amount_payable
        );

        /*
         * Ignore completely empty CSV lines.
         */
        if (
          !orderNumber &&
          !shippingNo &&
          !clean(rawRow.description)
        ) {
          return;
        }

        const errors = [];

        if (!orderNumber) {
          errors.push(
            "Order Number is missing"
          );
        }

        if (!shippingNo) {
          errors.push(
            "Waybill Number is missing"
          );
        }

        if (codAmount === null) {
          errors.push(
            "COD Amount is invalid"
          );
        }

        if (amountPayable === null) {
          errors.push(
            "Amount Payable is invalid"
          );
        }

        if (paymentMode !== "cod") {
          errors.push(
            `Unsupported Payment Mode: ${paymentMode || "empty"
            }`
          );
        }

        if (deliveryStatus !== "delivered") {
          errors.push(
            `Shipment is not delivered: ${deliveryStatus || "empty"
            }`
          );
        }

        if (errors.length) {
          invalidRows.push({
            rowNumber,
            orderNumber,
            shippingNo,
            reasons: errors,
            rawRow,
          });

          return;
        }

        const key = createRowKey({
          orderNumber,
          shippingNo,
        });

        if (seenKeys.has(key)) {
          duplicateRows.push({
            rowNumber,
            orderNumber,
            shippingNo,
            reason:
              "Duplicate Order Number and Waybill Number in uploaded report",
            rawRow,
          });

          return;
        }

        seenKeys.add(key);

        const differenceAmount =
          Number(
            (
              amountPayable - codAmount
            ).toFixed(2)
          );

        rows.push({
          source: "delhivery",

          reportType:
            "remittance_transactions",

          recordType: "cod_remittance",

          /*
           * Matching identifiers
           */
          orderNumber,
          shippingNo,
          waybillNumber: shippingNo,

          /*
           * Shipment information
           */
          description: clean(
            rawRow.description
          ),

          client: clean(rawRow.client),

          city: clean(rawRow.city),

          pincode: clean(
            rawRow.pincode
          ),

          deliveryStatus,

          /*
           * Payment information
           */
          paymentMode,
          orderType: "cod",

          expectedAmount: codAmount,

          receivedAmount:
            amountPayable,

          codAmount,

          amountPayable,

          remittedAmount:
            amountPayable,

          differenceAmount,

          /*
           * Not present in this report.
           * Keep null instead of guessing.
           */
          deliveredDate: null,

          remittanceDate: null,

          utr: "",

          providerReference:
            shippingNo,

          reconciliationStatus:
            Math.abs(
              differenceAmount
            ) <= 0.01
              ? "amount_matched"
              : "amount_mismatch",

          importRowNumber:
            rowNumber,

          rawRow: {
            description: clean(
              rawRow.description
            ),

            paymentMode: clean(
              rawRow.payment_mode
            ),

            client: clean(
              rawRow.client
            ),

            pincode: clean(
              rawRow.pincode
            ),

            amountPayable:
              clean(
                rawRow.amount_payable
              ),

            city: clean(rawRow.city),

            status: clean(
              rawRow.status
            ),

            codAmount: clean(
              rawRow.cod_amount
            ),

            waybillNumber:
              shippingNo,

            orderNumber,
          },
        });
      })
      .on("end", resolve)
      .on("error", reject);
  });

  const missingHeaders =
    REQUIRED_HEADERS.filter(
      (header) =>
        !detectedHeaders.includes(header)
    );

  if (missingHeaders.length) {
    throw new Error(
      `Invalid Delhivery report. Missing columns: ${missingHeaders.join(
        ", "
      )}`
    );
  }

  if (!rows.length) {
    throw new Error(
      "No valid Delhivery remittance rows found"
    );
  }

  const totalCodAmount = rows.reduce(
    (total, row) =>
      total + row.codAmount,
    0
  );

  const totalAmountPayable =
    rows.reduce(
      (total, row) =>
        total + row.amountPayable,
      0
    );

  return {
    source: "delhivery",

    reportType:
      "remittance_transactions",

    rows,

    invalidRows,

    duplicateRows,

    stats: {
      rowsRead:
        rows.length +
        invalidRows.length +
        duplicateRows.length,

      validRows: rows.length,

      invalidRows:
        invalidRows.length,

      duplicateRows:
        duplicateRows.length,

      matchedAmountRows:
        rows.filter(
          (row) =>
            row.reconciliationStatus ===
            "amount_matched"
        ).length,

      mismatchedAmountRows:
        rows.filter(
          (row) =>
            row.reconciliationStatus ===
            "amount_mismatch"
        ).length,

      totalCodAmount:
        Number(
          totalCodAmount.toFixed(2)
        ),

      totalAmountPayable:
        Number(
          totalAmountPayable.toFixed(2)
        ),

      totalDifference:
        Number(
          (
            totalAmountPayable -
            totalCodAmount
          ).toFixed(2)
        ),
    },
  };
}
