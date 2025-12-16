// src/models/Reel.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const isUrl = (v) => {
  try {
    const u = new URL(String(v));
    return ["http:", "https:"].includes(u.protocol);
  } catch {
    return false;
  }
};

const slugify = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const ReelProductSchema = new Schema(
  {
    // Prefer linking your real Product model:
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null, index: true },

    // Snapshot fields (so reels still render even if product changes/deletes)
    name: { type: String, trim: true, default: "" },
    slug: { type: String, trim: true, lowercase: true, default: "" },
    image: { type: String, trim: true, default: "" },
    price: { type: Number, default: 0 },
    currency: { type: String, default: "INR", trim: true },

    // Optional deep link override (if you want to point to a custom URL)
    href: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const ReelAnalyticsSchema = new Schema(
  {
    views: { type: Number, default: 0, min: 0 },
    clicks: { type: Number, default: 0, min: 0 },
    likes: { type: Number, default: 0, min: 0 },
    shares: { type: Number, default: 0, min: 0 },

    lastViewedAt: { type: Date, default: null },
    lastClickedAt: { type: Date, default: null },
  },
  { _id: false }
);

const ReelSchema = new Schema(
  {
    // Core
    title: { type: String, trim: true, default: "" }, // optional internal label
    src: {
      type: String,
      required: true,
      trim: true,
      validate: { validator: isUrl, message: "src must be a valid http(s) URL" },
    },
    poster: { type: String, trim: true, default: "" }, // optional poster image
    caption: { type: String, trim: true, default: "" },
    hashtags: {
      type: [String],
      default: [],
      set: (arr) =>
        Array.from(
          new Set(
            (Array.isArray(arr) ? arr : [])
              .map((x) => String(x || "").trim())
              .filter(Boolean)
              .map((x) => (x.startsWith("#") ? x : `#${x}`))
          )
        ),
    },

    // Product link/snapshot
    product: { type: ReelProductSchema, default: () => ({}) },

    // Status / visibility
    isActive: { type: Boolean, default: true, index: true }, // ✅ active/inactive
    activeFrom: { type: Date, default: null },
    activeTo: { type: Date, default: null },

    // Placement / ordering (for “Fashion In Motion” row)
    placement: {
      type: String,
      enum: ["home_row", "product_page", "category_page", "global"],
      default: "home_row",
      index: true,
    },
    priority: { type: Number, default: 0, index: true }, // higher first
    tags: { type: [String], default: [] }, // backend/admin filters
    language: { type: String, default: "en", trim: true },

    // Admin fields
    slug: { type: String, trim: true, lowercase: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    // Optional moderation/audit
    notes: { type: String, trim: true, default: "" },

    // Basic analytics counters
    analytics: { type: ReelAnalyticsSchema, default: () => ({}) },
  },
  { timestamps: true }
);

/**
 * ✅ Virtual "currentlyActive"
 * True only if isActive is true AND (activeFrom/activeTo window allows it)
 */
ReelSchema.virtual("currentlyActive").get(function () {
  if (!this.isActive) return false;
  const now = Date.now();
  const fromOk = !this.activeFrom || this.activeFrom.getTime() <= now;
  const toOk = !this.activeTo || this.activeTo.getTime() >= now;
  return fromOk && toOk;
});

/**
 * ✅ Query helper: Reel.find().activeNow()
 */
ReelSchema.query.activeNow = function () {
  const now = new Date();
  return this.where({
    isActive: true,
    $and: [
      { $or: [{ activeFrom: null }, { activeFrom: { $lte: now } }] },
      { $or: [{ activeTo: null }, { activeTo: { $gte: now } }] },
    ],
  });
};

/**
 * Auto-generate slug if missing
 */
ReelSchema.pre("validate", function (next) {
  if (!this.slug) {
    // Prefer title, else fall back to caption, else src tail
    const base =
      this.title ||
      this.caption ||
      (() => {
        try {
          const u = new URL(this.src);
          return u.pathname.split("/").filter(Boolean).pop() || "reel";
        } catch {
          return "reel";
        }
      })();

    this.slug = slugify(base);
  }
  next();
});

/**
 * Useful compound index for your home row:
 * placement + isActive + priority + createdAt
 */
ReelSchema.index({ placement: 1, isActive: 1, priority: -1, createdAt: -1 });

// Prevent model overwrite in dev/hot-reload
export default mongoose.models.Reel || mongoose.model("Reel", ReelSchema);
