const ALLOWED_SIZES = ["XS", "S", "M", "L", "XL"];

/**
 * Normalizes a product code to five digits.
 * Examples: 23 -> 00023, "00023" -> 00023
 */
export const normalizeProductCode = (productCode) => {
  const value = String(productCode ?? "").trim();

  if (!value) {
    throw new Error("Product code is required");
  }

  // Accept numeric product codes only.
  if (!/^\d+$/.test(value)) {
    throw new Error("Product code must contain digits only");
  }

  if (value.length > 5) {
    throw new Error("Product code cannot be longer than 5 digits");
  }

  return value.padStart(5, "0");
};

/**
 * Normalizes and validates a size.
 * Accepted sizes: XS, S, M, L, XL
 */
export const normalizeSize = (size) => {
  const value = String(size ?? "").trim().toUpperCase();

  if (!ALLOWED_SIZES.includes(value)) {
    throw new Error(`Invalid size "${size}". Allowed sizes: ${ALLOWED_SIZES.join(", ")}`);
  }

  return value;
};

/**
 * Creates a barcode in the format PRODUCTCODE-SIZE.
 * Example: 23 + "xs" -> "00023-XS"
 */
export const createProductBarcode = (productCode, size) => {
  const normalizedProductCode = normalizeProductCode(productCode);
  const normalizedSize = normalizeSize(size);

  return `${normalizedProductCode}-${normalizedSize}`;
};

/**
 * Creates barcodes for multiple sizes.
 * Example:
 * createProductBarcodes("23", ["xs", "s", "m"])
 * -> ["00023-XS", "00023-S", "00023-M"]
 */
export const createProductBarcodes = (productCode, sizes = ALLOWED_SIZES) => {
  if (!Array.isArray(sizes)) {
    throw new Error("Sizes must be provided as an array");
  }

  return sizes.map((size) => createProductBarcode(productCode, size));
};

/**
 * Reads the size from a barcode.
 * Example: "00023-xs" -> "XS"
 */
export const getSizeFromBarcode = (barcode) => {
  const value = String(barcode ?? "").trim().toUpperCase();
  const match = value.match(/^(\d{5})-(XS|S|M|L|XL)$/);

  if (!match) {
    throw new Error(
      'Invalid barcode. Expected format like "00023-XS"',
    );
  }

  return match[2];
};

/**
 * Validates a barcode and returns its normalized value.
 * Example: "23-xs" -> "00023-XS"
 */
export const normalizeProductBarcode = (barcode) => {
  const value = String(barcode ?? "").trim().toUpperCase();
  const match = value.match(/^(\d+)-(XS|S|M|L|XL)$/);

  if (!match) {
    throw new Error(
      'Invalid barcode. Expected format like "00023-XS"',
    );
  }

  return createProductBarcode(match[1], match[2]);
};

export { ALLOWED_SIZES };
