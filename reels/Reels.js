// src/models/Reel.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/* -----------------------------
   Helpers
------------------------------ */
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

/* =========================================================
   Product Snapshot Schema
========================================================= */
const ReelProductSchema = new Schema(
  {
    // ✅ link to your real Product model
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      default: null,
      index: true,
    },

    // ✅ snapshot fields (for safe render even if product deleted)
    name: { type: String, trim: true, default: "" },
    slug: { type: String, trim: true, lowercase: true, default: "" },
    image: { type: String, trim: true, default: "" },
    price: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "INR", trim: true },

    // ✅ optional deep link override
    href: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

/* =========================================================
   Analytics Schema
========================================================= */
const ReelAnalyticsSchema = new Schema(
  {
    // ✅ core counters
    views: { type: Number, default: 0, min: 0 }, // reel opened / seen
    uniqueViews: { type: Number, default: 0, min: 0 }, // optional: if you track uniq viewers
    taps: { type: Number, default: 0, min: 0 }, // product CTA tap (click)
    likes: { type: Number, default: 0, min: 0 },
    wishlist: { type: Number, default: 0, min: 0 },
    shares: { type: Number, default: 0, min: 0 },

    // ✅ timestamps for last action
    lastViewedAt: { type: Date, default: null },
    lastTappedAt: { type: Date, default: null },
    lastLikedAt: { type: Date, default: null },
    lastWishlistedAt: { type: Date, default: null },
    lastSharedAt: { type: Date, default: null },
  },
  { _id: false }
);

/* =========================================================
   Reel Schema
========================================================= */
const ReelSchema = new Schema(
  {
    /* ---------------- CORE ---------------- */
    title: { type: String, trim: true, default: "" }, // internal label
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

    /* ---------------- PRODUCT LINK ---------------- */
    product: { type: ReelProductSchema, default: () => ({}) },

    /* ---------------- VISIBILITY ---------------- */
    isActive: { type: Boolean, default: true, index: true },
    activeFrom: { type: Date, default: null },
    activeTo: { type: Date, default: null },

    /* ---------------- PLACEMENT / ORDERING ---------------- */
    placement: {
      type: String,
      enum: ["home_row", "product_page", "category_page", "global"],
      default: "home_row",
      index: true,
    },

    // ✅ higher = earlier
    priority: { type: Number, default: 0, index: true },

    tags: { type: [String], default: [] }, // admin filters
    language: { type: String, default: "en", trim: true },

    /* ---------------- ADMIN ---------------- */
    slug: { type: String, trim: true, lowercase: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    notes: { type: String, trim: true, default: "" },

    /* ---------------- ANALYTICS ---------------- */
    analytics: { type: ReelAnalyticsSchema, default: () => ({}) },
  },
  { timestamps: true }
);

/* =========================================================
   Virtual: currentlyActive
========================================================= */
ReelSchema.virtual("currentlyActive").get(function () {
  if (!this.isActive) return false;
  const now = Date.now();
  const fromOk = !this.activeFrom || this.activeFrom.getTime() <= now;
  const toOk = !this.activeTo || this.activeTo.getTime() >= now;
  return fromOk && toOk;
});

/* =========================================================
   Query helper: activeNow
========================================================= */
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

/* =========================================================
   Auto slug generation
========================================================= */
ReelSchema.pre("validate", function (next) {
  if (!this.slug) {
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

/* =========================================================
   Indexes
========================================================= */

// ✅ fast query for home row
ReelSchema.index({ placement: 1, isActive: 1, priority: -1, createdAt: -1 });

// ✅ analytics sorting / reporting
ReelSchema.index({ "analytics.views": -1 });
ReelSchema.index({ "analytics.likes": -1 });
ReelSchema.index({ "analytics.wishlist": -1 });
ReelSchema.index({ "analytics.taps": -1 });
ReelSchema.index({ "analytics.shares": -1 });

// Prevent overwrite in dev
export default mongoose.models.Reel || mongoose.model("Reel", ReelSchema);
