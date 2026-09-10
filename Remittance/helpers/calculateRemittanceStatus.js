// Remittance/helpers/calculateRemittanceStatus.js

const clean = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const parseAmount = (value) => {
  const amount = Number(value);

  return Number.isFinite(amount)
    ? amount
    : 0;
};

const firstValidAmount = (
  values = []
) => {
  for (const value of values) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      continue;
    }

    const amount = Number(value);

    if (Number.isFinite(amount)) {
      return amount;
    }
  }

  return null;
};

const getPaymentMethod = (
  order = {},
  row = {}
) =>
  clean(
    order.paymentMethod ||
    row.paymentMode ||
    row.orderType
  );

const getExpectedAmount = ({
  order = {},
  row = {},
}) => {
  const paymentMethod =
    getPaymentMethod(order, row);

  /*
   * Partial COD:
   * Prefer explicitly stored remaining
   * payable fields.
   */
  if (
    paymentMethod === "partial_cod" ||
    paymentMethod === "partial cod"
  ) {
    const remainingAmount =
      firstValidAmount([
        order.remainingPayable,
        order.remainingAmount,
        order.balanceAmount,
        order.codPayableAmount,
        order.codAmount,
        row.expectedAmount,
        row.codAmount,
        row.orderValue,
      ]);

    return {
      amount:
        remainingAmount ?? 0,

      source:
        remainingAmount !== null
          ? "partial_cod_balance"
          : "unknown",
    };
  }

  /*
   * Full COD:
   * Order finalPayable is authoritative.
   */
  if (paymentMethod === "cod") {
    const orderAmount =
      firstValidAmount([
        order.finalPayable,
        order.totalAmount,
        order.grandTotal,
        row.expectedAmount,
        row.codAmount,
        row.orderValue,
      ]);

    return {
      amount: orderAmount ?? 0,

      source:
        order.finalPayable !==
          undefined &&
          order.finalPayable !== null
          ? "order_final_payable"
          : "provider_report",
    };
  }

  /*
   * Prepaid reconciliation will be
   * implemented with Razorpay later.
   */
  const prepaidAmount =
    firstValidAmount([
      order.paidAmount,
      order.amountPaid,
      order.finalPayable,
      row.expectedAmount,
    ]);

  return {
    amount: prepaidAmount ?? 0,

    source:
      prepaidAmount !== null
        ? "prepaid_amount"
        : "unknown",
  };
};

/**
 * Calculates final reconciliation status.
 *
 * @param {Object} params
 * @param {Object} params.row
 * @param {Object|null} params.order
 * @param {boolean} params.matched
 * @param {boolean} params.duplicate
 * @param {number} params.tolerance
 */
export default function calculateRemittanceStatus({
  row = {},
  order = null,
  matched = Boolean(order),
  duplicate = false,
  tolerance = 1,
} = {}) {
  if (duplicate) {
    return {
      status: "duplicate",

      isRemitted: false,

      requiresReview: true,

      reason:
        "This provider transaction was already imported",
    };
  }

  if (!matched || !order) {
    return {
      status: "unmapped",

      isRemitted: false,

      requiresReview: true,

      reason:
        "No matching order found",
    };
  }

  const source = clean(row.source);

  const paymentMethod =
    getPaymentMethod(order, row);

  /*
   * Courier remittance reports should
   * not settle prepaid-only orders.
   */
  if (
    (source === "shiprocket" ||
      source === "delhivery") &&
    (paymentMethod === "prepaid" ||
      paymentMethod === "razorpay")
  ) {
    return {
      status: "payment_mode_mismatch",

      isRemitted: false,

      requiresReview: true,

      reason:
        "Courier COD remittance found for a prepaid order",
    };
  }

  const expected =
    getExpectedAmount({
      order,
      row,
    });

  const receivedAmount =
    parseAmount(
      row.receivedAmount ??
      row.remittedAmount
    );

  const differenceAmount = Number(
    (
      receivedAmount -
      expected.amount
    ).toFixed(2)
  );

  const absoluteDifference =
    Math.abs(differenceAmount);

  /*
   * Source-specific proof.
   */
  let providerConfirmed = false;
  let providerConfirmationReason = "";

  if (source === "shiprocket") {
    const crfStatus = clean(
      row.crfStatus ||
      row.providerStatus
    );

    providerConfirmed =
      [
        "remittance_success",
        "remitted",
        "success",
      ].includes(crfStatus) &&
      Boolean(row.utr) &&
      Boolean(row.remittanceDate);

    if (!providerConfirmed) {
      providerConfirmationReason =
        "Shiprocket CRF success, UTR or remittance date is missing";
    }
  } else if (source === "delhivery") {
    const deliveryStatus = clean(
      row.deliveryStatus
    );

    /*
     * Uploaded file itself is an
     * order-wise remittance transaction
     * export. UTR is not provided.
     */
    providerConfirmed =
      deliveryStatus === "delivered" &&
      receivedAmount > 0;

    if (!providerConfirmed) {
      providerConfirmationReason =
        "Delhivery shipment is not delivered or payable amount is missing";
    }
  } else if (source === "razorpay") {
    providerConfirmed = false;

    providerConfirmationReason =
      "Razorpay order-wise reconciliation is disabled";
  }

  if (!providerConfirmed) {
    return {
      status: "needs_review",

      isRemitted: false,

      requiresReview: true,

      expectedAmount:
        expected.amount,

      expectedAmountSource:
        expected.source,

      receivedAmount,

      differenceAmount,

      reason:
        providerConfirmationReason,
    };
  }

  if (receivedAmount <= 0) {
    return {
      status: "pending",

      isRemitted: false,

      requiresReview: false,

      expectedAmount:
        expected.amount,

      expectedAmountSource:
        expected.source,

      receivedAmount,

      differenceAmount,

      reason:
        "No remittance amount received",
    };
  }

  if (
    absoluteDifference <= tolerance
  ) {
    return {
      status: "fully_remitted",

      isRemitted: true,

      requiresReview: false,

      expectedAmount:
        expected.amount,

      expectedAmountSource:
        expected.source,

      receivedAmount,

      differenceAmount,

      reason:
        "Expected and received amounts matched",
    };
  }

  if (
    receivedAmount <
    expected.amount
  ) {
    return {
      status: "partially_remitted",

      isRemitted: false,

      requiresReview: true,

      expectedAmount:
        expected.amount,

      expectedAmountSource:
        expected.source,

      receivedAmount,

      differenceAmount,

      pendingAmount: Number(
        (
          expected.amount -
          receivedAmount
        ).toFixed(2)
      ),

      reason:
        "Received amount is lower than expected amount",
    };
  }

  return {
    status: "excess_remitted",

    isRemitted: false,

    requiresReview: true,

    expectedAmount:
      expected.amount,

    expectedAmountSource:
      expected.source,

    receivedAmount,

    differenceAmount,

    excessAmount: Number(
      (
        receivedAmount -
        expected.amount
      ).toFixed(2)
    ),

    reason:
      "Received amount is greater than expected amount",
  };
}

export {
  getExpectedAmount,
};
