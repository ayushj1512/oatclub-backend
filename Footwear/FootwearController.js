import mongoose from "mongoose";
import Footwear from "../Footwear/Footwear.js";

/* ------------------------- utils ------------------------- */
const safeLower = (v) => String(v || "").trim().toLowerCase();

function parseIntSafe(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function parseFloatSafe(v, def) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

function uniqLowerArray(arr) {
  return Array.from(
    new Set((arr || []).map((x) => safeLower(x)).filter(Boolean))
  );
}

function buildSort(sort) {
  // allowlist sort keys
  const map = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    price_asc: { price: 1 },
    price_desc: { price: -1 },
    rating_desc: { averageRating: -1 },
    popular_desc: { "analytics.purchases": -1 },
    featured: { isFeatured: -1, createdAt: -1 },
  };
  return map[sort] || map.newest;
}

function buildPublicMatch(q) {
  const match = {
    isDraft: false,
    isActive: true,
  };

  // quick filters
  if (q.category) match.categories = safeLower(q.category);
  if (q.gender) match["footwear.gender"] = safeLower(q.gender);
  if (q.type) match["footwear.type"] = safeLower(q.type);

  if (q.occasion) {
    const occ = Array.isArray(q.occasion) ? q.occasion : String(q.occasion).split(",");
    match["footwear.occasion"] = { $in: uniqLowerArray(occ) };
  }

  if (q.upperMaterial) {
    const mats = Array.isArray(q.upperMaterial)
      ? q.upperMaterial
      : String(q.upperMaterial).split(",");
    match["footwear.upperMaterial"] = { $in: uniqLowerArray(mats) };
  }

  if (q.soleMaterial) {
    const mats = Array.isArray(q.soleMaterial)
      ? q.soleMaterial
      : String(q.soleMaterial).split(",");
    match["footwear.soleMaterial"] = { $in: uniqLowerArray(mats) };
  }

  if (q.color) {
    match.colors = safeLower(q.color);
  }

  // price range
  const minPrice = q.minPrice != null ? parseFloatSafe(q.minPrice, null) : null;
  const maxPrice = q.maxPrice != null ? parseFloatSafe(q.maxPrice, null) : null;
  if (minPrice != null || maxPrice != null) {
    match.price = {};
    if (minPrice != null) match.price.$gte = minPrice;
    if (maxPrice != null) match.price.$lte = maxPrice;
  }

  // size filter (variable products)
  // supports: ?size=7 or ?size=7,8
  if (q.size) {
    const sizes = Array.isArray(q.size) ? q.size : String(q.size).split(",");
    match["variants.size"] = { $in: sizes.map((s) => String(s).trim()).filter(Boolean) };
  }

  // search
  if (q.search) {
    match.$text = { $search: String(q.search).trim() };
  }

  return match;
}

function buildAdminMatch(q) {
  const match = {};

  if (q.isActive != null) match.isActive = String(q.isActive) === "true";
  if (q.isDraft != null) match.isDraft = String(q.isDraft) === "true";
  if (q.isFeatured != null) match.isFeatured = String(q.isFeatured) === "true";

  if (q.category) match.categories = safeLower(q.category);
  if (q.gender) match["footwear.gender"] = safeLower(q.gender);
  if (q.type) match["footwear.type"] = safeLower(q.type);

  if (q.search) match.$text = { $search: String(q.search).trim() };

  // allow admin to filter by sku / code / slug quickly
  if (q.sku) {
    const sku = String(q.sku).trim();
    match.$or = [
      { sku },
      { "variants.sku": sku },
      { footwearCode: sku },
      { slug: safeLower(sku) },
    ];
  }

  return match;
}

function pickVariant(doc, { variantId, variantSku, size, color } = {}) {
  const variants = Array.isArray(doc?.variants) ? doc.variants : [];
  if (!variants.length) return null;

  // priority: variantId > variantSku > (size+color) > size > color
  if (variantId && mongoose.isValidObjectId(variantId)) {
    const v = variants.find((x) => String(x?._id) === String(variantId));
    if (v) return v;
  }

  if (variantSku) {
    const v = variants.find((x) => String(x?.sku || "") === String(variantSku));
    if (v) return v;
  }

  const s = size != null ? String(size).trim() : "";
  const c = color != null ? safeLower(color) : "";

  if (s && c) {
    const v = variants.find(
      (x) => String(x?.size || "").trim() === s && safeLower(x?.color) === c
    );
    if (v) return v;
  }

  if (s) {
    const v = variants.find((x) => String(x?.size || "").trim() === s);
    if (v) return v;
  }

  if (c) {
    const v = variants.find((x) => safeLower(x?.color) === c);
    if (v) return v;
  }

  return variants[0] || null;
}

function buildOrderSnapshotFromFootwear(doc, variant) {
  // Compatible with your orderItemSchema.productSnapshot + variant snapshot
  const snap = {
    productCode: String(doc.footwearCode || ""), // ✅ will be like F00001
    title: String(doc.title || ""),
    slug: String(doc.slug || ""),
    thumbnail: String(doc.thumbnail || ""),
    images: Array.isArray(doc.images) ? doc.images : [],
    productType: String(doc.productType || "simple"),
    sku: String(doc.sku || ""), // for simple
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    hsnCode: String(doc.hsnCode || ""),
    weight: Number(doc.weight || 0),
    currency: String(doc.currency || "INR"),
  };

  const variantSnap = {
    variantId: variant?._id ? variant._id : null,
    sku: String(variant?.sku || ""),
    attributes: Array.isArray(variant?.attributes) ? variant.attributes.map((a) => ({
      key: String(a?.key || ""),
      value: String(a?.value || ""),
    })) : [],
    weight: Number(variant?.weight || 0),
  };

  const selectedSize = String(variant?.size || "");
  const selectedColor = String(variant?.color || "");

  return { productSnapshot: snap, variant: variantSnap, selectedSize, selectedColor };
}

/* ------------------------- PUBLIC (E-COM) ------------------------- */

// GET /api/footwear
export async function listFootwearPublic(req, res) {
  try {
    const page = Math.max(1, parseIntSafe(req.query.page, 1));
    const limit = Math.min(60, Math.max(1, parseIntSafe(req.query.limit, 24)));
    const sort = buildSort(req.query.sort);
    const match = buildPublicMatch(req.query);

    const projection = {
      title: 1,
      slug: 1,
      footwearCode: 1,
      price: 1,
      compareAtPrice: 1,
      currency: 1,
      thumbnail: 1,
      images: 1,
      tags: 1,
      colors: 1,
      productType: 1,
      isActive: 1,
      isDraft: 1,
      averageRating: 1,
      totalReviews: 1,
      "footwear.type": 1,
      "footwear.gender": 1,
      "footwear.occasion": 1,
      "footwear.upperMaterial": 1,
      "footwear.soleMaterial": 1,
      // keep variants light for listing; frontend can show sizes/colors
      variants: 1,
    };

    const [items, total] = await Promise.all([
      Footwear.find(match)
        .select(projection)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Footwear.countDocuments(match),
    ]);

    return res.json({
      ok: true,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      items,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// GET /api/footwear/:slug
export async function getFootwearBySlugPublic(req, res) {
  try {
    const slug = safeLower(req.params.slug);

    const doc = await Footwear.findOne({
      slug,
      isDraft: false,
      isActive: true,
    }).lean();

    if (!doc) return res.status(404).json({ ok: false, message: "Not found" });

    // Analytics increment (non-blocking best effort)
    Footwear.updateOne({ _id: doc._id }, { $inc: { "analytics.views": 1 } }).catch(() => {});

    return res.json({ ok: true, item: doc });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// POST /api/footwear/resolve-for-checkout
// body: { footwearId OR slug OR footwearCode, variantId|variantSku|size|color, quantity }
export async function resolveFootwearForCheckout(req, res) {
  try {
    const { footwearId, slug, footwearCode, variantId, variantSku, size, color, quantity } = req.body || {};

    const qty = Math.max(1, parseIntSafe(quantity, 1));

    const query = {};
    if (footwearId && mongoose.isValidObjectId(footwearId)) query._id = footwearId;
    else if (slug) query.slug = safeLower(slug);
    else if (footwearCode) query.footwearCode = String(footwearCode).trim();
    else return res.status(400).json({ ok: false, message: "Provide footwearId / slug / footwearCode" });

    // only active non-draft allowed for ecom checkout
    query.isActive = true;
    query.isDraft = false;

    const doc = await Footwear.findOne(query).lean();
    if (!doc) return res.status(404).json({ ok: false, message: "Footwear not found" });

    const isVariable = Array.isArray(doc.variants) && doc.variants.length > 0;

    let stockAvailable = 0;
    let chosenVariant = null;

    if (isVariable) {
      chosenVariant = pickVariant(doc, { variantId, variantSku, size, color });
      if (!chosenVariant) return res.status(400).json({ ok: false, message: "Variant required" });

      stockAvailable = Number(chosenVariant.stock || 0);
      if (stockAvailable < qty) {
        return res.status(409).json({
          ok: false,
          message: "Insufficient stock",
          available: stockAvailable,
        });
      }
    } else {
      stockAvailable = Number(doc.stock || 0);
      if (stockAvailable < qty) {
        return res.status(409).json({
          ok: false,
          message: "Insufficient stock",
          available: stockAvailable,
        });
      }
    }

    // Return what order-service needs to build order item snapshot
    const snapshot = buildOrderSnapshotFromFootwear(doc, chosenVariant);

    return res.json({
      ok: true,
      footwearId: String(doc._id),
      productModel: "Footwear", // ✅ for polymorphic order item (recommended)
      unitPrice: Number(doc.price || 0),
      compareAtPrice: doc.compareAtPrice ?? null,
      currency: String(doc.currency || "INR"),
      quantity: qty,
      stockAvailable,
      snapshot,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}

/* ------------------------- ADMIN ------------------------- */

// GET /admin/footwear
export async function listFootwearAdmin(req, res) {
  try {
    const page = Math.max(1, parseIntSafe(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, parseIntSafe(req.query.limit, 30)));
    const sort = buildSort(req.query.sort);
    const match = buildAdminMatch(req.query);

    const [items, total] = await Promise.all([
      Footwear.find(match)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Footwear.countDocuments(match),
    ]);

    return res.json({
      ok: true,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      items,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// GET /admin/footwear/:id
export async function getFootwearAdmin(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const doc = await Footwear.findById(id).lean();
    if (!doc) return res.status(404).json({ ok: false, message: "Not found" });

    return res.json({ ok: true, item: doc });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// POST /admin/footwear
export async function createFootwear(req, res) {
  try {
    // You can validate deeper with zod/joi in middleware;
    // here we keep robust defaults + normalization.
    const payload = req.body || {};

    if (!payload.title) return res.status(400).json({ ok: false, message: "title required" });
    if (!payload.slug) return res.status(400).json({ ok: false, message: "slug required" });
    if (payload.price == null) return res.status(400).json({ ok: false, message: "price required" });

    payload.slug = safeLower(payload.slug);
    if (Array.isArray(payload.tags)) payload.tags = uniqLowerArray(payload.tags);
    if (Array.isArray(payload.colors)) payload.colors = uniqLowerArray(payload.colors);
    if (Array.isArray(payload.categories)) payload.categories = uniqLowerArray(payload.categories);

    // normalize footwear block arrays
    if (payload.footwear) {
      if (Array.isArray(payload.footwear.occasion)) payload.footwear.occasion = uniqLowerArray(payload.footwear.occasion);
      if (Array.isArray(payload.footwear.upperMaterial)) payload.footwear.upperMaterial = uniqLowerArray(payload.footwear.upperMaterial);
      if (Array.isArray(payload.footwear.soleMaterial)) payload.footwear.soleMaterial = uniqLowerArray(payload.footwear.soleMaterial);
      if (payload.footwear.type) payload.footwear.type = safeLower(payload.footwear.type);
      if (payload.footwear.gender) payload.footwear.gender = safeLower(payload.footwear.gender);
      if (payload.footwear.closureType) payload.footwear.closureType = safeLower(payload.footwear.closureType);
    }

    // normalize variants
    if (Array.isArray(payload.variants)) {
      payload.variants = payload.variants.map((v) => ({
        ...v,
        color: v?.color ? safeLower(v.color) : v?.color,
        size: v?.size != null ? String(v.size).trim() : v?.size,
      }));
    }

    const doc = await Footwear.create(payload);
    return res.status(201).json({ ok: true, item: doc });
  } catch (e) {
    // handle duplicate key (slug/sku/footwearCode etc.)
    if (String(e?.code) === "11000") {
      return res.status(409).json({ ok: false, message: "Duplicate key", details: e.keyValue || {} });
    }
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// PATCH /admin/footwear/:id
export async function updateFootwear(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const payload = req.body || {};
    if (payload.slug) payload.slug = safeLower(payload.slug);

    if (Array.isArray(payload.tags)) payload.tags = uniqLowerArray(payload.tags);
    if (Array.isArray(payload.colors)) payload.colors = uniqLowerArray(payload.colors);
    if (Array.isArray(payload.categories)) payload.categories = uniqLowerArray(payload.categories);

    if (payload.footwear) {
      if (Array.isArray(payload.footwear.occasion)) payload.footwear.occasion = uniqLowerArray(payload.footwear.occasion);
      if (Array.isArray(payload.footwear.upperMaterial)) payload.footwear.upperMaterial = uniqLowerArray(payload.footwear.upperMaterial);
      if (Array.isArray(payload.footwear.soleMaterial)) payload.footwear.soleMaterial = uniqLowerArray(payload.footwear.soleMaterial);
      if (payload.footwear.type) payload.footwear.type = safeLower(payload.footwear.type);
      if (payload.footwear.gender) payload.footwear.gender = safeLower(payload.footwear.gender);
      if (payload.footwear.closureType) payload.footwear.closureType = safeLower(payload.footwear.closureType);
    }

    if (Array.isArray(payload.variants)) {
      payload.variants = payload.variants.map((v) => ({
        ...v,
        color: v?.color ? safeLower(v.color) : v?.color,
        size: v?.size != null ? String(v.size).trim() : v?.size,
      }));
    }

    const updated = await Footwear.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });

    if (!updated) return res.status(404).json({ ok: false, message: "Not found" });
    return res.json({ ok: true, item: updated });
  } catch (e) {
    if (String(e?.code) === "11000") {
      return res.status(409).json({ ok: false, message: "Duplicate key", details: e.keyValue || {} });
    }
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// DELETE /admin/footwear/:id  (hard delete; many teams prefer soft delete)
export async function deleteFootwear(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const deleted = await Footwear.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ ok: false, message: "Not found" });

    return res.json({ ok: true, message: "Deleted" });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// PATCH /admin/footwear/:id/publish  body { isDraft, isActive }
export async function setPublishState(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const { isDraft, isActive, publishAt } = req.body || {};
    const $set = {};
    if (isDraft != null) $set.isDraft = !!isDraft;
    if (isActive != null) $set.isActive = !!isActive;
    if (publishAt != null) $set.publishAt = new Date(publishAt);

    const updated = await Footwear.findByIdAndUpdate(id, { $set }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ ok: false, message: "Not found" });

    return res.json({ ok: true, item: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// PATCH /admin/footwear/:id/featured  body { isFeatured }
export async function setFeatured(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const { isFeatured } = req.body || {};
    const updated = await Footwear.findByIdAndUpdate(
      id,
      { $set: { isFeatured: !!isFeatured } },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ ok: false, message: "Not found" });

    return res.json({ ok: true, item: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// POST /admin/footwear/bulk
// body: { ids:[], action:"activate|deactivate|draft|undraft|feature|unfeature|delete" }
export async function bulkAction(req, res) {
  try {
    const { ids, action } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ ok: false, message: "ids required" });

    const objectIds = ids.filter((x) => mongoose.isValidObjectId(x)).map((x) => new mongoose.Types.ObjectId(x));
    if (!objectIds.length) return res.status(400).json({ ok: false, message: "No valid ids" });

    const map = {
      activate: { $set: { isActive: true } },
      deactivate: { $set: { isActive: false } },
      draft: { $set: { isDraft: true } },
      undraft: { $set: { isDraft: false } },
      feature: { $set: { isFeatured: true } },
      unfeature: { $set: { isFeatured: false } },
    };

    if (action === "delete") {
      const r = await Footwear.deleteMany({ _id: { $in: objectIds } });
      return res.json({ ok: true, deleted: r.deletedCount || 0 });
    }

    if (!map[action]) return res.status(400).json({ ok: false, message: "Invalid action" });

    const r = await Footwear.updateMany({ _id: { $in: objectIds } }, map[action], { runValidators: true });
    return res.json({ ok: true, matched: r.matchedCount || r.n || 0, modified: r.modifiedCount || r.nModified || 0 });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// PATCH /admin/footwear/:id/stock
// body: { mode:"set|inc", productStock, variantId, variantSku, size, color, value }
export async function updateStock(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const { mode = "set", productStock, variantId, variantSku, size, color, value } = req.body || {};
    const doc = await Footwear.findById(id);
    if (!doc) return res.status(404).json({ ok: false, message: "Not found" });

    const isVariable = Array.isArray(doc.variants) && doc.variants.length > 0;

    // If simple product stock update:
    if (!isVariable) {
      if (productStock == null && value == null) return res.status(400).json({ ok: false, message: "productStock/value required" });
      const v = productStock != null ? Number(productStock) : Number(value);
      doc.stock = mode === "inc" ? (Number(doc.stock || 0) + v) : v;
      await doc.save();
      return res.json({ ok: true, item: doc });
    }

    // variable: find variant
    const chosen = pickVariant(doc, { variantId, variantSku, size, color });
    if (!chosen) return res.status(400).json({ ok: false, message: "Variant not found" });

    if (value == null) return res.status(400).json({ ok: false, message: "value required" });
    const delta = Number(value);

    chosen.stock = mode === "inc" ? (Number(chosen.stock || 0) + delta) : delta;
    await doc.save();

    return res.json({ ok: true, item: doc });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}
