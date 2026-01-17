/**
 * scripts/migrate-products-to-new-schema.js
 *
 * ✅ Migrates existing products to be compatible with the NEW Product schema.
 * ✅ Reads MONGO_URI from .env using dotenv/config
 * ✅ Normalizes:
 *   - product.attributes (attribute object -> ObjectId)
 *   - variant.attributes (adds attribute ObjectId by mapping key -> product.attributes)
 *   - defaults: avgFabricConsumption, dimensions, analytics, arrays
 *   - tags lowercase
 *   - hsnCode digits-only
 *   - fabrics string[] -> [{fabricCode, role}]
 * ✅ Calls .save() so your NEW hooks run (productType, SKU generation, inventory flags, auto-unpublish)
 */

import "dotenv/config";
import mongoose from "mongoose";
import Product from "../Products/Products.js"; // <-- adjust if your path differs

const MONGO_URI = process.env.MONGO_URI;

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
  // keep digits only (new schema validator allows empty or digits-only)
  return s.replace(/\D+/g, "");
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

  // ensure arrays
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

  // collections -> ObjectId if possible
  p.collections = p.collections
    .map((c) => {
      if (!c) return null;
      // populated object case: { _id: ... }
      if (typeof c === "object" && c._id) return toObjectId(c._id);
      return toObjectId(c);
    })
    .filter(Boolean);

  // fabrics: if old stored ["COTTON","..."] convert to new shape
  if (p.fabrics.length && typeof p.fabrics[0] === "string") {
    p.fabrics = p.fabrics
      .filter(Boolean)
      .map((code) => ({ fabricCode: String(code).trim(), role: "main" }))
      .filter((x) => x.fabricCode);
  } else {
    // if objects exist, normalize keys a bit
    p.fabrics = p.fabrics
      .filter(Boolean)
      .map((f) => {
        if (typeof f === "string") return { fabricCode: f.trim(), role: "main" };
        const fabricCode = String(f.fabricCode ?? f.code ?? "").trim();
        const role = (f.role || "main").trim();
        return { fabricCode, role };
      })
      .filter((x) => x.fabricCode);
  }

  // thumbnail fallback
  if (!p.thumbnail) p.thumbnail = p.images?.[0] || "";

  // publishAt fallback
  if (!p.publishAt) p.publishAt = new Date();
}

function normalizeAttributesAndVariants(p) {
  // product.attributes normalize: attribute object -> attribute _id
  p.attributes = (p.attributes || [])
    .filter(Boolean)
    .map((a) => {
      let attrId = a?.attribute;

      // populated object: {attribute:{_id,...}}
      if (attrId && typeof attrId === "object" && attrId._id) attrId = attrId._id;

      // sometimes old shape: attribute: {_id, name, ...}
      if (a?.attribute?._id) attrId = a.attribute._id;

      attrId = toObjectId(attrId);

      const key = a?.key ? String(a.key).trim() : "";
      const values = Array.isArray(a?.values) ? a.values.map((x) => String(x).trim()) : [];

      return { attribute: attrId, key, values };
    });

  // map key(lowercase) -> attribute ObjectId
  const attrMap = new Map();
  for (const a of p.attributes) {
    if (a?.key && a?.attribute) attrMap.set(a.key.trim().toLowerCase(), a.attribute);
  }

  // variants.attributes normalize: add "attribute" ObjectId if missing
  p.variants = (p.variants || []).map((v) => {
    if (!v || typeof v !== "object") return v;

    if (!Array.isArray(v.attributes)) v.attributes = [];

    v.attributes = v.attributes
      .filter(Boolean)
      .map((va) => {
        const key = va?.key ? String(va.key).trim() : "";
        const value = va?.value ? String(va.value).trim() : "";

        let attrId = va?.attribute;

        // populated object: {attribute:{_id,...}}
        if (attrId && typeof attrId === "object" && attrId._id) attrId = attrId._id;

        attrId = toObjectId(attrId);

        // if still missing, map via key -> product.attributes
        if (!attrId && key) attrId = attrMap.get(key.toLowerCase());

        return { attribute: attrId, key, value };
      });

    return v;
  });

  // If variable product, product-level sku not used
  if (Array.isArray(p.variants) && p.variants.length > 0) {
    p.sku = undefined;
  }
}

async function run() {
  if (!MONGO_URI) {
    throw new Error("❌ Missing MONGO_URI in .env");
  }

  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to MongoDB");

  const cursor = Product.find({}).cursor();

  let processed = 0;
  let updated = 0;
  let failed = 0;

  for await (const p of cursor) {
    processed++;

    try {
      ensureDefaults(p);
      normalizeAttributesAndVariants(p);

      // IMPORTANT: save triggers your NEW schema hooks:
      // - productType calc
      // - productCode generation if missing
      // - SKU generation
      // - inventory flags (isInStock, auto-unpublish)
      await p.save();

      updated++;
    } catch (e) {
      failed++;
      console.error(`❌ Failed product ${p?._id} (${p?.slug || "no-slug"}): ${e?.message}`);
    }

    if (processed % 100 === 0) {
      console.log(`...processed=${processed} updated=${updated} failed=${failed}`);
    }
  }

  console.log("✅ Migration complete:", { processed, updated, failed });
  await mongoose.disconnect();
  console.log("✅ Disconnected");
}

run().catch((e) => {
  console.error("❌ Migration crashed:", e);
  process.exit(1);
});
