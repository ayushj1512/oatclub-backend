// utility/variants.js

/**
 * Normalize attribute combo into a stable key
 * Example: Size:S|Color:Black
 */
const comboKey = (attrs = []) =>
  attrs
    .map(a => `${a.key}:${a.value}`)
    .sort()
    .join("|");

/**
 * Generate cartesian product of variant attributes
 */
const cartesian = (arr) =>
  arr.reduce(
    (a, b) =>
      a.flatMap(x =>
        b.values.map(v => [...x, { key: b.key, value: v }])
      ),
    [[]]
  );

/**
 * MAIN VARIANT GENERATOR
 *
 * @param {Array} productAttributes  product.attributes
 * @param {Array} existingVariants   product.variants
 * @param {Array} variantKeys        ["size", "color"] (case-insensitive)
 */
export const generateVariants = ({
  productAttributes = [],
  existingVariants = [],
  variantKeys = [],
}) => {
  // 1️⃣ pick only attributes that create variants
  const variantAttrs = productAttributes.filter(a =>
    variantKeys.includes(String(a.key).toLowerCase()) &&
    Array.isArray(a.values) &&
    a.values.length > 0
  );

  if (!variantAttrs.length) return [];

  // 2️⃣ map existing variants for preservation
  const existingMap = new Map();
  existingVariants.forEach(v => {
    const key = comboKey(v.attributes || []);
    existingMap.set(key, v);
  });

  // 3️⃣ generate new combinations
  const combinations = cartesian(variantAttrs);

  // 4️⃣ build final variants (preserve price/stock/sku)
  return combinations.map(attrs => {
    const key = comboKey(attrs);
    const old = existingMap.get(key);

    return {
      attributes: attrs,
      price: old?.price ?? 0,
      compareAtPrice: old?.compareAtPrice ?? null,
      stock: old?.stock ?? 0,
      isInStock: old ? old.stock > 0 : false,
      sku: old?.sku, // SKU auto-generated later if missing
      image: old?.image ?? "",
      weight: old?.weight ?? 0,
    };
  });
};
