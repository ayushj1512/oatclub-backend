// miray-backend/utility/sku.js

const clean = (s = "") =>
  String(s)
    .toUpperCase()
    .trim()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .replace(/--+/g, "-");

const short = (s, n) => clean(s).slice(0, n);

const rand = (len = 4) =>
  Math.random().toString(36).slice(2, 2 + len).toUpperCase();

/**
 * Build a human-readable unique-ish SKU.
 * Example: MIR-TSHIRT-TEST123-M-BLACK-9F2K
 */
export function generateSKU({
  brand = "MIR",
  category = "",
  title = "",
  size = "",
  color = "",
  suffixLen = 4,
} = {}) {
  const parts = [
    short(brand, 6),
    short(category, 10),
    short(title, 14),
    size ? short(size, 6) : null,
    color ? short(color, 6) : null,
    rand(suffixLen),
  ].filter(Boolean);

  return parts.join("-");
}

/**
 * Ensure SKU is actually unique in DB (server truth).
 * - fieldPath can be "sku" or "variants.sku"
 */
export async function generateUniqueSKU(
  Model,
  params,
  fieldPath = "sku",
  maxTries = 30
) {
  for (let i = 0; i < maxTries; i++) {
    const sku = generateSKU(params);

    // For variants.sku we must query nested array
    const query =
      fieldPath === "variants.sku"
        ? { "variants.sku": sku }
        : { [fieldPath]: sku };

    const exists = await Model.exists(query);
    if (!exists) return sku;
  }

  // If very unlucky with collisions, extend randomness
  return generateSKU({ ...params, suffixLen: 6 });
}

/**
 * Stable variant key (NOT SKU) — useful for duplicate detection.
 */
export function variantKey({ size = "", color = "", attributes = {} } = {}) {
  const keys = Object.keys(attributes || {}).sort();
  const attrs = keys.map((k) => `${clean(k)}:${clean(attributes[k])}`).join("|");
  return [
    size ? `SIZE:${clean(size)}` : null,
    color ? `COLOR:${clean(color)}` : null,
    attrs || null,
  ]
    .filter(Boolean)
    .join("|");
}
