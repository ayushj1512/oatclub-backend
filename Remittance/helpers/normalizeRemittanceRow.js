// Remittance/helpers/normalizeRemittanceRow.js

const clean = (value) =>
  String(value ?? "").trim();

const normalizeOrderNumber = (value) =>
  clean(value).toUpperCase();

const normalizeSource = (value) => {
  const source = clean(value).toLowerCase();

  if (
    source === "shiprocket" ||
    source === "delhivery" ||
    source === "razorpay"
  ) {
    return source;
  }

  return "";
};

const normalizePaymentMode = (value) => {
  const mode = clean(value).toLowerCase();

  if (mode === "cod") return "cod";

  if (
    mode === "prepaid" ||
    mode === "razorpay" ||
    mode === "online"
  ) {
    return "prepaid";
  }

  if (
    mode === "partial_cod" ||
    mode === "partial cod"
  ) {
    return "partial_cod";
  }

  return mode;
};

const parseAmount = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  const amount = Number(
    String(value).replace(/[₹,\s]/g, "")
  );

  return Number.isFinite(amount)
    ? amount
    : 0;
};

const parseDate = (value) => {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
};

/**
 * Converts any provider parser row into
 * one common remittance structure.
 */
export default function normalizeRemittanceRow(
  row = {}
) {
  const source = normalizeSource(
    row.source
  );

  if (!source) {
    throw new Error(
      "Invalid remittance source"
    );
  }

  const orderNumber =
    normalizeOrderNumber(
      row.orderNumber ||
      row.orderId
    );

  const shippingNo = clean(
    row.shippingNo ||
    row.awb ||
    row.waybillNumber
  ).replace(/\.0+$/, "");

  const expectedAmount = parseAmount(
    row.expectedAmount ??
    row.codAmount ??
    row.orderValue
  );

  const receivedAmount = parseAmount(
    row.receivedAmount ??
    row.remittedAmount ??
    row.amountPayable
  );

  const adjustedAmount = parseAmount(
    row.adjustedAmount
  );

  const differenceAmount = Number(
    (
      receivedAmount -
      expectedAmount
    ).toFixed(2)
  );

  const paymentMode =
    normalizePaymentMode(
      row.paymentMode ||
      row.orderType
    );

  return {
    source,

    reportType: clean(
      row.reportType
    ),

    recordType:
      clean(row.recordType) ||
      "cod_remittance",

    /*
     * Order matching identifiers
     */
    orderNumber,

    shippingNo,

    awb: shippingNo,

    ewayBillId: clean(
      row.ewayBillId
    ),

    /*
     * Payment identifiers
     */
    providerReference: clean(
      row.providerReference ||
      row.crfId ||
      row.settlementId ||
      shippingNo
    ),

    crfId: clean(row.crfId),

    settlementId: clean(
      row.settlementId
    ),

    paymentId: clean(
      row.paymentId
    ),

    utr: clean(row.utr),

    /*
     * Payment information
     */
    paymentMode,

    orderType:
      paymentMode === "prepaid"
        ? "razorpay"
        : paymentMode,

    expectedAmount,

    receivedAmount,

    remittedAmount:
      receivedAmount,

    adjustedAmount,

    differenceAmount,

    /*
     * Dates
     */
    shippedDate: parseDate(
      row.shippedDate
    ),

    deliveredDate: parseDate(
      row.deliveredDate
    ),

    remittanceDate: parseDate(
      row.remittanceDate ||
      row.settlementDate
    ),

    /*
     * Provider information
     */
    courier: clean(row.courier),

    deliveryStatus: clean(
      row.deliveryStatus
    ).toLowerCase(),

    providerStatus: clean(
      row.crfStatus ||
      row.status
    ).toLowerCase(),

    description: clean(
      row.description
    ),

    city: clean(row.city),

    pincode: clean(row.pincode),

    /*
     * Import information
     */
    importRowNumber:
      Number(row.importRowNumber) ||
      null,

    rawRow:
      row.rawRow &&
        typeof row.rawRow === "object"
        ? row.rawRow
        : {},

    importedAt: new Date(),
  };
}

export {
  clean,
  normalizeOrderNumber,
  normalizePaymentMode,
  normalizeSource,
  parseAmount,
  parseDate,
};
