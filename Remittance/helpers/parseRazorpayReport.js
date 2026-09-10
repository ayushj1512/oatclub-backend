// Remittance/helpers/parseRazorpayReport.js

/**
 * Temporary Razorpay parser.
 *
 * The current Razorpay settlement
 * report does not contain order-level
 * identifiers, so reconciliation is
 * intentionally disabled.
 */
export default async function parseRazorpayReport(
  _filePath
) {
  const error = new Error(
    "Razorpay order-wise remittance import is currently disabled"
  );

  error.code =
    "RAZORPAY_IMPORT_DISABLED";

  error.statusCode = 400;

  throw error;
}
