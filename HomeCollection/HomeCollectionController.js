import mongoose from "mongoose";
import HomeCollection from "../models/HomeCollection.js";

/* ---------------- helpers ---------------- */
const str = (v) => (v == null ? "" : String(v)).trim();
const lower = (v) => str(v).toLowerCase();
const isUrlLike = (v) => {
  const s = str(v);
  if (!s) return false;
  // allow absolute urls and /uploads/... style
  return /^https?:\/\/.+/i.test(s) || s.startsWith("/");
};

const jsonOK = (res, payload) => res.status(200).json({ ok: true, ...payload });
const jsonBad = (res, msg, extra = {}) =>
  res.status(400).json({ ok: false, message: msg, ...extra });
const json404 = (res, msg = "Not found") =>
  res.status(404).json({ ok: false, message: msg });

/**
 * Ensure slug is clean & URL-friendly.
 * If you already enforce slug generation elsewhere, you can simplify this.
 */
const normalizeSlug = (s) =>
  lower(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

/* ---------------- controllers ---------------- */

/**
 * ✅ CREATE
 * body: { imageUrl, name, slug, isActive?, position? }
 */
export const createHomeCollection = async (req, res) => {
  try {
    const imageUrl = str(req.body?.imageUrl);
    const name = str(req.body?.name);
    const slug = normalizeSlug(req.body?.slug);

    const isActive =
      typeof req.body?.isActive === "boolean" ? req.body.isActive : true;

    const position = Number.isFinite(Number(req.body?.position))
      ? Number(req.body.position)
      : 0;

    if (!imageUrl || !isUrlLike(imageUrl))
      return jsonBad(res, "Valid imageUrl is required");
    if (!name) return jsonBad(res, "name is required");
    if (!slug) return jsonBad(res, "slug is required");

    const exists = await HomeCollection.findOne({ slug }).lean();
    if (exists) return jsonBad(res, "slug already exists", { field: "slug" });

    const doc = await HomeCollection.create({
      imageUrl,
      name,
      slug,
      isActive,
      position,
    });

    return jsonOK(res, { item: doc });
  } catch (e) {
    // handle unique index collisions
    if (e?.code === 11000) {
      return jsonBad(res, "Duplicate key", { key: e?.keyValue });
    }
    return res.status(500).json({ ok: false, message: e?.message || String(e) });
  }
};

/**
 * ✅ LIST (Admin)
 * query: ?q=&isActive=&sort=position|newest|oldest|name
 */
export const listHomeCollections = async (req, res) => {
  try {
    const q = str(req.query?.q);
    const isActiveQ = req.query?.isActive;
    const sortKey = str(req.query?.sort) || "position";

    const filter = {};
    if (typeof isActiveQ !== "undefined") {
      if (String(isActiveQ) === "true") filter.isActive = true;
      if (String(isActiveQ) === "false") filter.isActive = false;
    }

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { slug: { $regex: q, $options: "i" } },
      ];
    }

    let sort = { position: 1, createdAt: -1 };
    if (sortKey === "newest") sort = { createdAt: -1 };
    if (sortKey === "oldest") sort = { createdAt: 1 };
    if (sortKey === "name") sort = { name: 1 };

    const items = await HomeCollection.find(filter).sort(sort).lean();
    return jsonOK(res, { items });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || String(e) });
  }
};

/**
 * ✅ LIST PUBLIC (Homepage)
 * returns only active, ordered by position
 */
export const listActiveHomeCollections = async (req, res) => {
  try {
    const items = await HomeCollection.find({ isActive: true })
      .sort({ position: 1, createdAt: -1 })
      .lean();

    return jsonOK(res, { items });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || String(e) });
  }
};

/**
 * ✅ GET BY ID
 */
export const getHomeCollectionById = async (req, res) => {
  try {
    const id = str(req.params?.id);
    if (!mongoose.Types.ObjectId.isValid(id))
      return jsonBad(res, "Invalid id");

    const item = await HomeCollection.findById(id).lean();
    if (!item) return json404(res);
    return jsonOK(res, { item });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || String(e) });
  }
};

/**
 * ✅ GET BY SLUG (useful for frontend routes)
 */
export const getHomeCollectionBySlug = async (req, res) => {
  try {
    const slug = normalizeSlug(req.params?.slug);
    if (!slug) return jsonBad(res, "Invalid slug");

    const item = await HomeCollection.findOne({ slug }).lean();
    if (!item) return json404(res);
    return jsonOK(res, { item });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || String(e) });
  }
};

/**
 * ✅ UPDATE (partial)
 * body can include: imageUrl, name, slug, isActive, position
 */
export const updateHomeCollection = async (req, res) => {
  try {
    const id = str(req.params?.id);
    if (!mongoose.Types.ObjectId.isValid(id))
      return jsonBad(res, "Invalid id");

    const patch = {};
    if (typeof req.body?.imageUrl !== "undefined") {
      const imageUrl = str(req.body.imageUrl);
      if (!imageUrl || !isUrlLike(imageUrl))
        return jsonBad(res, "Valid imageUrl is required");
      patch.imageUrl = imageUrl;
    }

    if (typeof req.body?.name !== "undefined") {
      const name = str(req.body.name);
      if (!name) return jsonBad(res, "name cannot be empty");
      patch.name = name;
    }

    if (typeof req.body?.slug !== "undefined") {
      const slug = normalizeSlug(req.body.slug);
      if (!slug) return jsonBad(res, "slug cannot be empty");

      const exists = await HomeCollection.findOne({
        slug,
        _id: { $ne: id },
      }).lean();

      if (exists) return jsonBad(res, "slug already exists", { field: "slug" });

      patch.slug = slug;
    }

    if (typeof req.body?.isActive === "boolean") patch.isActive = req.body.isActive;

    if (typeof req.body?.position !== "undefined") {
      const position = Number(req.body.position);
      if (!Number.isFinite(position)) return jsonBad(res, "Invalid position");
      patch.position = position;
    }

    const item = await HomeCollection.findByIdAndUpdate(id, patch, {
      new: true,
      runValidators: true,
    });

    if (!item) return json404(res);
    return jsonOK(res, { item });
  } catch (e) {
    if (e?.code === 11000) return jsonBad(res, "Duplicate key", { key: e?.keyValue });
    return res.status(500).json({ ok: false, message: e?.message || String(e) });
  }
};

/**
 * ✅ TOGGLE ACTIVE (quick enable/disable)
 */
export const toggleHomeCollectionActive = async (req, res) => {
  try {
    const id = str(req.params?.id);
    if (!mongoose.Types.ObjectId.isValid(id))
      return jsonBad(res, "Invalid id");

    const item = await HomeCollection.findById(id);
    if (!item) return json404(res);

    item.isActive = !item.isActive;
    await item.save();

    return jsonOK(res, { item });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || String(e) });
  }
};

/**
 * ✅ DELETE (hard delete)
 */
export const deleteHomeCollection = async (req, res) => {
  try {
    const id = str(req.params?.id);
    if (!mongoose.Types.ObjectId.isValid(id))
      return jsonBad(res, "Invalid id");

    const item = await HomeCollection.findByIdAndDelete(id);
    if (!item) return json404(res);

    return jsonOK(res, { deleted: true });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || String(e) });
  }
};

/**
 * ✅ BULK REORDER (homepage drag/drop)
 * body: { items: [{ id, position }, ...] }
 */
export const reorderHomeCollections = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return jsonBad(res, "items array is required");

    // validate
    for (const it of items) {
      const id = str(it?.id);
      const position = Number(it?.position);
      if (!mongoose.Types.ObjectId.isValid(id)) return jsonBad(res, "Invalid id in items");
      if (!Number.isFinite(position)) return jsonBad(res, "Invalid position in items");
    }

    await session.withTransaction(async () => {
      const ops = items.map((it) => ({
        updateOne: {
          filter: { _id: it.id },
          update: { $set: { position: Number(it.position) } },
        },
      }));
      await HomeCollection.bulkWrite(ops, { session });
    });

    return jsonOK(res, { reordered: true });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || String(e) });
  } finally {
    session.endSession();
  }
};

/**
 * ✅ BULK UPSERT (seed/import)
 * body: { items: [{ imageUrl, name, slug, isActive?, position? }, ...] }
 */
export const upsertHomeCollections = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return jsonBad(res, "items array is required");

    // basic validate & normalize
    const clean = items.map((x) => {
      const imageUrl = str(x?.imageUrl);
      const name = str(x?.name);
      const slug = normalizeSlug(x?.slug);
      const isActive = typeof x?.isActive === "boolean" ? x.isActive : true;
      const position = Number.isFinite(Number(x?.position)) ? Number(x.position) : 0;

      if (!imageUrl || !isUrlLike(imageUrl)) throw new Error("Invalid imageUrl in items");
      if (!name) throw new Error("Invalid name in items");
      if (!slug) throw new Error("Invalid slug in items");

      return { imageUrl, name, slug, isActive, position };
    });

    await session.withTransaction(async () => {
      const ops = clean.map((it) => ({
        updateOne: {
          filter: { slug: it.slug },
          update: { $set: it },
          upsert: true,
        },
      }));
      await HomeCollection.bulkWrite(ops, { session });
    });

    return jsonOK(res, { upserted: true, count: items.length });
  } catch (e) {
    if (e?.code === 11000) return jsonBad(res, "Duplicate key", { key: e?.keyValue });
    return res.status(500).json({ ok: false, message: e?.message || String(e) });
  } finally {
    session.endSession();
  }
};
