// src/controllers/reels/Reels.js
import mongoose from "mongoose";

// ✅ IMPORTANT: Update path according to your project
// Example: import Reel from "../../models/Reel.js";
import Reel from "./Reels.js";

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

/**
 * ✅ Normalize product payload
 * Supports:
 *  - productId (ObjectId)
 *  - snapshot fields: name, slug, image, price, currency, href
 */
const normalizeProductPayload = (product = {}) => {
  const p = product && typeof product === "object" ? product : {};
  return {
    productId: isObjectId(p.productId) ? p.productId : null,
    name: String(p.name || "").trim(),
    slug: String(p.slug || "").trim().toLowerCase(),
    image: String(p.image || "").trim(),
    price: Number.isFinite(Number(p.price)) ? Number(p.price) : 0,
    currency: String(p.currency || "INR").trim(),
    href: String(p.href || "").trim(),
  };
};

const parseBool = (v, fallback = undefined) => {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase().trim();
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return fallback;
};

const parseNum = (v, fallback = undefined) => {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const parseDate = (v, fallback = undefined) => {
  if (v === undefined || v === null || v === "") return fallback;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : fallback;
};

const parseStringArray = (v) => {
  if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean);
  if (typeof v === "string") {
    return v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
};

/* =========================================================
   CREATE REEL
   POST /api/reels
========================================================= */
export async function createReel(req, res) {
  try {
    const body = req.body || {};

    const doc = await Reel.create({
      title: String(body.title || "").trim(),
      src: String(body.src || "").trim(),
      poster: String(body.poster || "").trim(),
      caption: String(body.caption || "").trim(),
      hashtags: parseStringArray(body.hashtags),
      tags: parseStringArray(body.tags),

      placement: body.placement || "home_row",
      priority: parseNum(body.priority, 0),

      isActive: parseBool(body.isActive, true),
      activeFrom: parseDate(body.activeFrom, null),
      activeTo: parseDate(body.activeTo, null),

      language: String(body.language || "en").trim(),
      notes: String(body.notes || "").trim(),

      product: normalizeProductPayload(body.product),

      createdBy: req.user?._id || null,
      updatedBy: req.user?._id || null,
    });

    return res.status(201).json({ reel: doc });
  } catch (err) {
    if (err?.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    console.error("❌ createReel error:", err);
    return res.status(500).json({ message: "Failed to create reel" });
  }
}

/* =========================================================
   LIST REELS (filters + pagination)
   GET /api/reels
========================================================= */
export async function listReels(req, res) {
  try {
    const {
      activeNow,
      isActive,
      placement,
      q,
      page = "1",
      limit = "20",
      sort = "priority",
    } = req.query || {};

    const pageN = Math.max(1, Number(page) || 1);
    const limitN = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (pageN - 1) * limitN;

    let query = Reel.find();

    if (parseBool(activeNow, false)) {
      query = query.activeNow();
    } else {
      const isActiveBool = parseBool(isActive, undefined);
      if (typeof isActiveBool === "boolean")
        query = query.where({ isActive: isActiveBool });
    }

    if (placement) query = query.where({ placement: String(placement) });

    if (q && String(q).trim()) {
      const needle = String(q).trim();
      query = query.where({
        $or: [
          { title: { $regex: needle, $options: "i" } },
          { caption: { $regex: needle, $options: "i" } },
          { hashtags: { $elemMatch: { $regex: needle, $options: "i" } } },
          { tags: { $elemMatch: { $regex: needle, $options: "i" } } },
          { "product.name": { $regex: needle, $options: "i" } },
          { "product.slug": { $regex: needle, $options: "i" } },
        ],
      });
    }

    const sortMap = {
      priority: { priority: -1, createdAt: -1 },
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      mostViewed: { "analytics.views": -1 },
      mostLiked: { "analytics.likes": -1 },
    };

    const sortObj = sortMap[String(sort)] || sortMap.priority;

    const [items, total] = await Promise.all([
      query.sort(sortObj).skip(skip).limit(limitN).lean(),
      Reel.countDocuments(query.getQuery()),
    ]);

    return res.json({
      reels: items,
      page: pageN,
      limit: limitN,
      total,
      hasMore: skip + items.length < total,
    });
  } catch (err) {
    console.error("❌ listReels error:", err);
    return res.status(500).json({ message: "Failed to list reels" });
  }
}

/* =========================================================
   GET ONE REEL
   GET /api/reels/:idOrSlug
========================================================= */
export async function getReel(req, res) {
  try {
    const { idOrSlug } = req.params;

    const query = isObjectId(idOrSlug)
      ? { _id: idOrSlug }
      : { slug: String(idOrSlug || "").trim().toLowerCase() };

    const reel = await Reel.findOne(query).lean();
    if (!reel) return res.status(404).json({ message: "Reel not found" });

    return res.json({ reel });
  } catch (err) {
    console.error("❌ getReel error:", err);
    return res.status(500).json({ message: "Failed to get reel" });
  }
}

/* =========================================================
   UPDATE REEL
   PATCH /api/reels/:id
========================================================= */
export async function updateReel(req, res) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ message: "Invalid reel id" });

    const body = req.body || {};
    const patch = {};

    if (body.title !== undefined) patch.title = String(body.title || "").trim();
    if (body.src !== undefined) patch.src = String(body.src || "").trim();
    if (body.poster !== undefined) patch.poster = String(body.poster || "").trim();
    if (body.caption !== undefined) patch.caption = String(body.caption || "").trim();

    if (body.hashtags !== undefined) patch.hashtags = parseStringArray(body.hashtags);
    if (body.tags !== undefined) patch.tags = parseStringArray(body.tags);

    if (body.placement !== undefined) patch.placement = String(body.placement || "home_row");
    if (body.priority !== undefined) patch.priority = parseNum(body.priority, 0);

    if (body.isActive !== undefined) patch.isActive = parseBool(body.isActive, true);
    if (body.activeFrom !== undefined) patch.activeFrom = parseDate(body.activeFrom, null);
    if (body.activeTo !== undefined) patch.activeTo = parseDate(body.activeTo, null);

    if (body.language !== undefined) patch.language = String(body.language || "en").trim();
    if (body.notes !== undefined) patch.notes = String(body.notes || "").trim();

    if (body.product !== undefined) patch.product = normalizeProductPayload(body.product);

    patch.updatedBy = req.user?._id || null;

    const updated = await Reel.findByIdAndUpdate(id, patch, {
      new: true,
      runValidators: true,
    });

    if (!updated) return res.status(404).json({ message: "Reel not found" });

    return res.json({ reel: updated });
  } catch (err) {
    if (err?.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    console.error("❌ updateReel error:", err);
    return res.status(500).json({ message: "Failed to update reel" });
  }
}

/* =========================================================
   TOGGLE ACTIVE
   PATCH /api/reels/:id/toggle
========================================================= */
export async function toggleReelActive(req, res) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ message: "Invalid reel id" });

    const current = await Reel.findById(id);
    if (!current) return res.status(404).json({ message: "Reel not found" });

    const desired = parseBool(req.body?.isActive, undefined);
    current.isActive = typeof desired === "boolean" ? desired : !current.isActive;
    current.updatedBy = req.user?._id || null;

    await current.save();
    return res.json({ reel: current });
  } catch (err) {
    console.error("❌ toggleReelActive error:", err);
    return res.status(500).json({ message: "Failed to toggle reel" });
  }
}

/* =========================================================
   DELETE REEL
   DELETE /api/reels/:id
========================================================= */
export async function deleteReel(req, res) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ message: "Invalid reel id" });

    const deleted = await Reel.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: "Reel not found" });

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ deleteReel error:", err);
    return res.status(500).json({ message: "Failed to delete reel" });
  }
}

/* =========================================================
   TRACK EVENTS
   POST /api/reels/:id/events
   Body: { type: "view"|"tap"|"like"|"wishlist"|"share", unique?: true }
========================================================= */
export async function trackReelEvent(req, res) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ message: "Invalid reel id" });

    const type = String(req.body?.type || "").toLowerCase().trim();
    const unique = parseBool(req.body?.unique, false);

    const inc = {};
    const set = {};

    const now = new Date();

    if (type === "view") {
      inc["analytics.views"] = 1;
      set["analytics.lastViewedAt"] = now;

      // ✅ optional
      if (unique) inc["analytics.uniqueViews"] = 1;
    } else if (type === "tap") {
      inc["analytics.taps"] = 1;
      set["analytics.lastTappedAt"] = now;
    } else if (type === "like") {
      inc["analytics.likes"] = 1;
      set["analytics.lastLikedAt"] = now;
    } else if (type === "wishlist") {
      inc["analytics.wishlist"] = 1;
      set["analytics.lastWishlistedAt"] = now;
    } else if (type === "share") {
      inc["analytics.shares"] = 1;
      set["analytics.lastSharedAt"] = now;
    } else {
      return res.status(400).json({
        message: "Invalid event type. Use view|tap|like|wishlist|share",
      });
    }

    const reel = await Reel.findByIdAndUpdate(
      id,
      {
        $inc: inc,
        $set: set,
      },
      { new: true }
    ).lean();

    if (!reel) return res.status(404).json({ message: "Reel not found" });

    return res.json({ ok: true, reel });
  } catch (err) {
    console.error("❌ trackReelEvent error:", err);
    return res.status(500).json({ message: "Failed to track event" });
  }
}
