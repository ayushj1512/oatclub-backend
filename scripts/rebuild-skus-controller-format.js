/**
 * scripts/fix-missing-size-and-sku.js
 *
 * Fixes variable products where variants are missing size attribute:
 * - Adds Size attribute into variants.attributes
 * - Sets variant SKU to CAT3-PRODUCTCODE-SIZE
 * - Unsets product-level sku for variable products
 *
 * Uses bulkWrite (NO doc.save) to avoid hooks overwriting SKUs.
 */

import "dotenv/config";
import mongoose from "mongoose";
import Product from "../Products/Products.js";      // ✅ your path
import Attribute from "../Attribute/Attribute.js";  // ✅ your path

const MONGO_URI = process.env.MONGO_URI;

const SYSTEM_CATEGORIES = new Set(["all-clothing", "new-arrivals", "best-sellers"]);
const DEFAULT_SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];

const skuSafe = (v) =>
  String(v || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const onlyLetters = (v) => skuSafe(v).replace(/[^A-Z]/g, "");

const pickMainCategory = (categories = []) => {
  const rawCats = Array.isArray(categories) ? categories : [];
  return (
    rawCats.find((c) => !SYSTEM_CATEGORIES.has(String(c).toLowerCase())) ||
    rawCats[0] ||
    "CAT"
  );
};

const getCategoryCode3 = (categories = []) => {
  const main = pickMainCategory(categories);
  const letters = onlyLetters(main);
  return (letters.slice(0, 3) || "CAT").toUpperCase();
};

const getProductCode = (p) => skuSafe(String(p?.productCode || "00000"));

const normalizeSize = (s) =>
  String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

const getVariantSize = (variant) => {
  const attrs = Array.isArray(variant?.attributes) ? variant.attributes : [];
  const found = attrs.find((a) => String(a?.key || "").toLowerCase() === "size");
  return normalizeSize(found?.value || "");
};

const hasSizeAttr = (variant) => {
  const attrs = Array.isArray(variant?.attributes) ? variant.attributes : [];
  return attrs.some(
    (a) => String(a?.key || "").toLowerCase() === "size" && String(a?.value || "").trim()
  );
};

const buildVariantSku = (cat3, productCode, size) =>
  `${cat3}-${productCode}-${skuSafe(size)}`;

async function run() {
  if (!MONGO_URI) throw new Error("❌ Missing MONGO_URI in .env");

  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to MongoDB");

  // ✅ find Size attribute id (by name OR slug)
  const sizeAttr = await Attribute.findOne({
    $or: [{ name: /^size$/i }, { slug: /^size$/i }],
  })
    .select({ _id: 1, name: 1, slug: 1 })
    .lean();

  if (!sizeAttr?._id) {
    throw new Error('❌ "Size" attribute not found in Attribute collection');
  }

  console.log("✅ Size attribute:", {
    _id: String(sizeAttr._id),
    name: sizeAttr.name,
    slug: sizeAttr.slug,
  });

  const cursor = Product.find({ variants: { $exists: true, $ne: [] } })
    .select({ categories: 1, productCode: 1, slug: 1, sku: 1, variants: 1 })
    .lean()
    .cursor();

  let processed = 0;
  let touched = 0;
  let updated = 0;
  let failed = 0;

  const ops = [];
  const FLUSH_EVERY = 100;

  async function flush() {
    if (!ops.length) return;
    try {
      const res = await Product.bulkWrite(ops, { ordered: false });
      updated += res.modifiedCount || 0;
    } catch (e) {
      failed++;
      console.error("❌ bulkWrite failed:", e?.message || e);
    } finally {
      ops.length = 0;
    }
  }

  for await (const p of cursor) {
    processed++;

    const variants = Array.isArray(p.variants) ? p.variants : [];
    if (!variants.length) continue;

    // only target products where ANY variant missing size
    const anyMissing = variants.some((v) => !hasSizeAttr(v));
    if (!anyMissing) continue;

    const cat3 = getCategoryCode3(p.categories);
    const productCode = getProductCode(p);

    // assign sizes by index
    const sizes = variants.map((_, idx) => DEFAULT_SIZE_ORDER[idx] || `SIZE${idx + 1}`);

    const setObj = { productType: "variable" };
    const unsetObj = { sku: "" }; // variable product should not keep product sku
    const arrayFilters = [];

    let anyChange = false;

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const vId = v?._id;
      if (!vId) continue;

      const label = `v${i}`;
      arrayFilters.push({
        [`${label}._id`]: new mongoose.Types.ObjectId(String(vId)),
      });

      const currentSize = getVariantSize(v);
      const sizeToUse = currentSize || sizes[i];

      // 1) ensure size attribute exists
      if (!hasSizeAttr(v)) {
        const existingAttrs = Array.isArray(v.attributes) ? v.attributes : [];
        const cleaned = existingAttrs.filter(
          (a) => String(a?.key || "").toLowerCase() !== "size"
        );

        cleaned.push({
          attribute: new mongoose.Types.ObjectId(String(sizeAttr._id)),
          key: "Size",
          value: sizeToUse,
        });

        setObj[`variants.$[${label}].attributes`] = cleaned;
        anyChange = true;
      }

      // 2) enforce SKU format
      const expectedSku = buildVariantSku(cat3, productCode, sizeToUse);
      const currentSku = String(v?.sku || "").trim();

      if (currentSku !== expectedSku) {
        setObj[`variants.$[${label}].sku`] = expectedSku;
        anyChange = true;
      }
    }

    if (!anyChange) continue;

    touched++;

    ops.push({
      updateOne: {
        filter: { _id: p._id },
        update: {
          $set: setObj,
          $unset: unsetObj,
        },
        arrayFilters,
      },
    });

    if (ops.length >= FLUSH_EVERY) await flush();

    if (processed % 200 === 0) {
      console.log(
        `...processed=${processed} touched=${touched} updated=${updated} failed=${failed}`
      );
    }
  }

  await flush();

  console.log("✅ Done:", { processed, touched, updated, failed });
  await mongoose.disconnect();
  console.log("✅ Disconnected");
}

run().catch((e) => {
  console.error("❌ Script crashed:", e);
  process.exit(1);
});
