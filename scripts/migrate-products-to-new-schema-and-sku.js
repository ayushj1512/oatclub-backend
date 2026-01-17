/**
 * scripts/migrate-products-to-new-schema-and-sku.js
 *
 * ✅ Reads MONGO_URI from .env
 * ✅ Normalizes old products to NEW schema
 * ✅ Fixes SKU formatting:
 *    - SIMPLE: legacy product.sku => unset => hook regenerates
 *    - VARIABLE: legacy variant.sku => unset => hook regenerates
 * ✅ Backfills missing variant.attributes[].attribute using:
 *    - product.attributes map (if present)
 *    - Attribute lookup by slug/name (based on your Attribute model)
 * ✅ Calls .save() so NEW Product schema hooks run:
 *    - productType computation
 *    - productCode generation (if missing)
 *    - SKU generation
 *    - inventory flags + auto-unpublish
 */

import "dotenv/config";
import mongoose from "mongoose";

import Product from "../Products/Products.js";     // <-- adjust path if needed
import Attribute from "../Attribute/Attribute.js"; // <-- adjust path if needed

const MONGO_URI = process.env.MONGO_URI;

// ---------------- helpers ----------------
function isObjectIdLike(v) {
  return typeof v === "string" && /^[a-fA-F0-9]{24}$/.test(v);
}

function toObjectId(v) {
  if (!v) return v;
  if (v instanceof mongoose.Types.ObjectId) return v;
  if (isObjectIdLike(v)) return new mongoose.Types.ObjectId(v);
  return v;
}

function normalizeHSN(v) {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s) return "";
  return s.replace(/\D+/g, "");
}

function slugifyKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function ensureDefaults(p) {
  // avgFabricConsumption
  if (!p.avgFabricConsumption || typeof p.avgFabricConsumption !== "object") {
    p.avgFabricConsumption = { value: 0, unit: "meter" };
  } else {
    if (typeof p.avgFabricConsumption.value !== "number") p.avgFabricConsumption.value = 0;
    if (!["meter", "gram"].includes(p.avgFabricConsumption.unit)) p.avgFabricConsumption.unit = "meter";
  }

  // dimensions
  if (!p.dimensions || typeof p.dimensions !== "object") {
    p.dimensions = { length: 0, width: 0, height: 0, unit: "cm" };
  } else {
    p.dimensions.length = Number(p.dimensions.length ?? 0) || 0;
    p.dimensions.width = Number(p.dimensions.width ?? 0) || 0;
    p.dimensions.height = Number(p.dimensions.height ?? 0) || 0;
    p.dimensions.unit = p.dimensions.unit || "cm";
  }

  // analytics
  if (!p.analytics || typeof p.analytics !== "object") {
    p.analytics = { views: 0, purchases: 0, wishlistCount: 0, cartAdds: 0, searchAppearances: 0 };
  } else {
    p.analytics.views = Number(p.analytics.views ?? 0) || 0;
    p.analytics.purchases = Number(p.analytics.purchases ?? 0) || 0;
    p.analytics.wishlistCount = Number(p.analytics.wishlistCount ?? 0) || 0;
    p.analytics.cartAdds = Number(p.analytics.cartAdds ?? 0) || 0;
    p.analytics.searchAppearances = Number(p.analytics.searchAppearances ?? 0) || 0;
  }

  // arrays
  if (!Array.isArray(p.categories)) p.categories = [];
  if (!Array.isArray(p.tags)) p.tags = [];
  if (!Array.isArray(p.fabrics)) p.fabrics = [];
  if (!Array.isArray(p.collections)) p.collections = [];
  if (!Array.isArray(p.images)) p.images = [];
  if (!Array.isArray(p.variants)) p.variants = [];
  if (!Array.isArray(p.attributes)) p.attributes = [];

  // tags lowercase
  p.tags = p.tags
    .filter(Boolean)
    .map((t) => String(t).trim().toLowerCase())
    .filter(Boolean);

  // hsn digits only
  p.hsnCode = normalizeHSN(p.hsnCode);

  // collections normalize -> ObjectId
  p.collections = p.collections
    .map((c) => {
      if (!c) return null;
      if (typeof c === "object" && c._id) return toObjectId(c._id);
      return toObjectId(c);
    })
    .filter(Boolean);

  // fabrics normalize
  if (p.fabrics.length && typeof p.fabrics[0] === "string") {
    p.fabrics = p.fabrics
      .filter(Boolean)
      .map((code) => ({ fabricCode: String(code).trim(), role: "main" }))
      .filter((x) => x.fabricCode);
  } else {
    p.fabrics = p.fabrics
      .filter(Boolean)
      .map((f) => {
        if (typeof f === "string") return { fabricCode: f.trim(), role: "main" };
        const fabricCode = String(f.fabricCode ?? f.code ?? "").trim();
        const role = String(f.role || "main").trim();
        return { fabricCode, role };
      })
      .filter((x) => x.fabricCode);
  }

  // thumbnail fallback
  if (!p.thumbnail) p.thumbnail = p.images?.[0] || "";

  // publishAt fallback
  if (!p.publishAt) p.publishAt = new Date();
}

function normalizeProductAttributes(p) {
  /**
   * product.attributes old may contain:
   * { attribute: { _id, name, ... }, key, values }
   * new wants:
   * { attribute: ObjectId, key, values }
   */
  p.attributes = (p.attributes || [])
    .filter(Boolean)
    .map((a) => {
      let attrId = a?.attribute;

      // populated object case
      if (attrId && typeof attrId === "object" && attrId._id) attrId = attrId._id;
      if (a?.attribute?._id) attrId = a.attribute._id;

      attrId = toObjectId(attrId);

      const key = a?.key ? String(a.key).trim() : "";
      const values = Array.isArray(a?.values) ? a.values.map((x) => String(x).trim()) : [];

      return { attribute: attrId, key, values };
    });

  // keyLower -> ObjectId map
  const attrMap = new Map();
  for (const a of p.attributes) {
    if (a?.key && a?.attribute) attrMap.set(a.key.trim().toLowerCase(), a.attribute);
  }
  return attrMap;
}

async function backfillVariantAttributeIds(p, attrMap) {
  /**
   * variant.attributes should be:
   * [{ attribute:ObjectId, key, value }]
   * If attribute missing:
   * 1) try from product.attributes map
   * 2) lookup Attribute model by slug/name
   */

  const cache = new Map(); // keyLower -> ObjectId|null

  async function getAttrIdByKey(keyRaw) {
    const keyLower = String(keyRaw || "").trim().toLowerCase();
    if (!keyLower) return null;

    // from product map
    if (attrMap.has(keyLower)) return attrMap.get(keyLower);

    // cached
    if (cache.has(keyLower)) return cache.get(keyLower);

    const slugCandidate = slugifyKey(keyLower);

    // Your Attribute model has unique slug + name, both indexed (text)
    const found = await Attribute.findOne({
      $or: [
        { slug: keyLower },
        { slug: slugCandidate },
        { name: new RegExp(`^${keyLower}$`, "i") },
      ],
    })
      .select({ _id: 1 })
      .lean();

    const id = found?._id ? new mongoose.Types.ObjectId(found._id) : null;
    cache.set(keyLower, id);
    return id;
  }

  // normalize variant attr objects first
  p.variants = (p.variants || []).map((v) => {
    if (!v || typeof v !== "object") return v;
    if (!Array.isArray(v.attributes)) v.attributes = [];

    v.attributes = v.attributes
      .filter(Boolean)
      .map((va) => {
        const key = va?.key ? String(va.key).trim() : "";
        const value = va?.value ? String(va.value).trim() : "";

        let attrId = va?.attribute;
        if (attrId && typeof attrId === "object" && attrId._id) attrId = attrId._id;
        attrId = toObjectId(attrId);

        return { attribute: attrId, key, value };
      });

    return v;
  });

  // async fill missing
  for (const v of p.variants || []) {
    for (const va of v.attributes || []) {
      if (!va.attribute && va.key) {
        const id = await getAttrIdByKey(va.key);
        if (id) va.attribute = id;
      }
    }
  }
}

function isLegacySku(sku) {
  if (!sku) return false;
  const s = String(sku).trim();
  if (!s) return false;

  // New seems MIR-... ; legacy examples: TOP-00236-XS
  return !s.startsWith("MIR-");
}

function markSkuForRegeneration(p) {
  const isVariable = Array.isArray(p.variants) && p.variants.length > 0;

  let touched = false;

  if (!isVariable) {
    if (p.sku && isLegacySku(p.sku)) {
      p.sku = undefined;
      touched = true;
    }
    return touched;
  }

  p.variants = p.variants.map((v) => {
    if (!v) return v;
    if (v.sku && isLegacySku(v.sku)) {
      v.sku = undefined;
      touched = true;
    }
    return v;
  });

  if (p.sku) {
    p.sku = undefined;
    touched = true;
  }

  return touched;
}

async function saveWithRetry(p, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await p.save();
      return { ok: true, attempt };
    } catch (e) {
      const msg = String(e?.message || "").toLowerCase();
      const isDup =
        e?.code === 11000 ||
        msg.includes("duplicate key") ||
        msg.includes("e11000");

      if (!isDup || attempt === maxRetries) throw e;

      // duplicate sku likely; force regeneration and retry
      markSkuForRegeneration(p);
    }
  }
  return { ok: false, attempt: maxRetries };
}

// ---------------- main ----------------
async function run() {
  if (!MONGO_URI) throw new Error("❌ Missing MONGO_URI in .env");

  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to MongoDB");

  const cursor = Product.find({}).cursor();

  let processed = 0;
  let updated = 0;
  let failed = 0;
  let skuFixed = 0;
  let variantAttrFixed = 0;

  for await (const p of cursor) {
    processed++;

    try {
      ensureDefaults(p);

      const attrMap = normalizeProductAttributes(p);

      const missingBefore = (p.variants || [])
        .flatMap((v) => v.attributes || [])
        .filter((a) => !a?.attribute).length;

      await backfillVariantAttributeIds(p, attrMap);

      const missingAfter = (p.variants || [])
        .flatMap((v) => v.attributes || [])
        .filter((a) => !a?.attribute).length;

      if (missingAfter < missingBefore) variantAttrFixed++;

      const touchedSku = markSkuForRegeneration(p);
      if (touchedSku) skuFixed++;

      // Ensure variable products don't keep product-level sku
      if (Array.isArray(p.variants) && p.variants.length > 0) {
        p.sku = undefined;
      }

      await saveWithRetry(p, 5);

      updated++;
    } catch (e) {
      failed++;
      console.error(`❌ Failed product ${p?._id} (${p?.slug || "no-slug"}): ${e?.message}`);
    }

    if (processed % 100 === 0) {
      console.log(
        `...processed=${processed} updated=${updated} failed=${failed} skuFixed=${skuFixed} variantAttrFixed=${variantAttrFixed}`
      );
    }
  }

  console.log("✅ Done:", { processed, updated, failed, skuFixed, variantAttrFixed });
  await mongoose.disconnect();
  console.log("✅ Disconnected");
}

run().catch((e) => {
  console.error("❌ Migration crashed:", e);
  process.exit(1);
});
