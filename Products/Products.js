import mongoose from "mongoose";
import Counter from "../models/Counter.js";

/* ------------------------------------------------------------------
VARIANT SCHEMA (NO IMAGES ❌, NO PRICE ✅)
------------------------------------------------------------------- */
const variantSchema = new mongoose.Schema(
  {
    /* ✅ PATTERN NUMBER (per-variant) */
    patternNumber: { type: String, trim: true, default: "", index: true },

    attributes: [
      {
        attribute: { type: mongoose.Schema.Types.ObjectId, ref: "Attribute" },
        key: { type: String, trim: true },
        value: { type: String, trim: true },
      },
    ],

    sku: { type: String, unique: true, sparse: true, trim: true, index: true },
    barcode: { type: String, trim: true, default: "" },

    // ✅ Inventory (per-variant)
    stock: { type: Number, default: 0 },
    isInStock: { type: Boolean, default: false },
    reservedStock: {
      type: Number,
      default: 0,
      min: 0,
      set: (v) => Math.max(0, Number(v ?? 0)),
    },

    weight: { type: Number, default: 0 },
  },
  { _id: true, timestamps: false }
);

/* ------------------------------------------------------------------
SPECIFICATIONS (like your screenshot)
Flexible key/value list so you can add/remove anytime ✅
------------------------------------------------------------------- */
const specRowSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true, required: true }, // e.g. "Color"
    value: { type: String, trim: true, default: "" }, // e.g. "Red"
  },
  { _id: false, timestamps: false }
);

/* ------------------------------------------------------------------
PRODUCT SCHEMA
------------------------------------------------------------------- */
const productSchema = new mongoose.Schema(
  {
    /* SEQUENTIAL PRODUCT CODE */
    productCode: { type: String, unique: true, required: true, index: true },

    /* BASIC */
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },

    /**
     * ✅ CONTENT (NO LONG DESCRIPTION ANYMORE)
     * shortDescription now contains:
     * - short intro
     * - howToStyle
     * - keyFeatures
     * - fabricDetails
     *
     * But we are also storing structured fields for UI rendering.
     */
    shortDescription: { type: String, default: "" },
    howToStyle: { type: String, default: "" },
    keyFeatures: [{ type: String, default: "" }],
    fabricDetails: { type: String, default: "" },

    /**
     * ✅ SPECIFICATIONS (as per screenshot)
     */
    specifications: { type: [specRowSchema], default: [] },

    /* CATEGORIES / COLLECTIONS */
    categories: { type: [String], default: [] },
    collections: [{ type: mongoose.Schema.Types.ObjectId, ref: "Collection" }],

    /* TAGS */
    tags: [{ type: String, trim: true, lowercase: true }],

    /* Colors */
    colors: [{ type: String, trim: true, lowercase: true, index: true }],

    /* PRICING (COMMON FOR ALL VARIANTS ✅) */
    price: { type: Number, required: true },
    compareAtPrice: { type: Number, default: null },
    currency: { type: String, default: "INR" },
    taxClass: { type: String, default: "standard" },

    /* INVENTORY (SIMPLE PRODUCT) */
    sku: { type: String, unique: true, sparse: true, trim: true, index: true },

    // ✅ Inventory (product level)
    stock: { type: Number, default: 0 },
    isInStock: { type: Boolean, default: false },
    reservedStock: {
      type: Number,
      default: 0,
      min: 0,
      set: (v) => Math.max(0, Number(v ?? 0)),
    },

    /* HSN CODE (numeric-only) */
    hsnCode: {
      type: String,
      trim: true,
      default: "",
      index: true,
      validate: {
        validator: function (v) {
          return v === "" || /^\d+$/.test(v);
        },
        message: "HSN code must contain digits only",
      },
    },

    /* FABRICS (MULTIPLE ✅) — fabricName required, rest optional */
    fabrics: [
      {
        fabricName: {
          type: String,
          trim: true,
          required: [true, "Fabric name is required"],
          index: true,
        },
        fabricCode: {
          type: String,
          trim: true,
          default: "",
          index: true,
        },
        fabricColor: {
          type: String,
          trim: true,
          default: "",
          index: true, // optional, useful for filtering
        },
        role: {
          type: String,
          trim: true,
          default: "main",
          enum: ["main", "lining", "contrast", "padding", "other"],
        },
      },
    ],

    /* AVG FABRIC CONSUMPTION (PRODUCT LEVEL ✅) */
    avgFabricConsumption: {
      value: { type: Number, min: 0, default: 0 },
      unit: { type: String, enum: ["meter", "gram"], default: "meter" },
    },

    /* ATTRIBUTES + VARIANTS */
    attributes: [
      {
        attribute: { type: mongoose.Schema.Types.ObjectId, ref: "Attribute" },
        key: String,
        values: [String],
      },
    ],
    variants: [variantSchema],

    /* MEDIA (PRODUCT LEVEL ✅) */
    images: [{ type: String }],
    thumbnail: { type: String, default: "" },
    video: { type: String, default: "" },

    /* SHIPPING */
    weight: { type: Number, default: 0 },
    dimensions: {
      length: { type: Number, default: 0 },
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
      unit: { type: String, default: "cm" },
    },

    /* REVIEWS */
    averageRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: "Review" }],

    /* OFFERS */
    offer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Offer",
      default: null,
    },
    couponsApplicable: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Coupon" },
    ],

    /* ANALYTICS */
    analytics: {
      views: { type: Number, default: 0 },
      purchases: { type: Number, default: 0 },
      wishlistCount: { type: Number, default: 0 },
      cartAdds: { type: Number, default: 0 },
      searchAppearances: { type: Number, default: 0 },
    },

    /* PRODUCT TYPE */
    productType: {
      type: String,
      enum: ["simple", "variable", "digital", "external"],
      default: "simple",
    },
    externalURL: { type: String, default: "" },

    /* CROSS SELL */
    crossSellProducts: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Product", index: true },
    ],

    /* SEO */
    metaTitle: { type: String, default: "" },
    metaDescription: { type: String, default: "" },
    keywords: [{ type: String }],

    /* PUBLISHING */
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    isDraft: { type: Boolean, default: false },
    publishAt: { type: Date, default: Date.now },

    isBestSeller: { type: Boolean, default: false, index: true },
    isTrending: { type: Boolean, default: false, index: true },

    // ✅ NEW: Pattern ready flag (product level)
    isPatternReady: { type: Boolean, default: false, index: true },

    // ✅ Existing (already present)
    isSamplingDone: { type: Boolean, default: false },

    // ✅ NEW: Original product link (string)
    // (keeps it flexible: can store URL, productCode, slug, or _id as string)
    originalProductLink: { type: String, trim: true, default: "" },

    wordpressId: { type: Number, default: null },

    // logic for primary vs secondary products (for discount offers etc)
    isPrimaryProduct: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

/* ------------------------------------------------------------------
HELPERS
------------------------------------------------------------------- */
function computeInventoryFlags(doc) {
  const isVariable = Array.isArray(doc.variants) && doc.variants.length > 0;

  /* ✅ SIMPLE PRODUCT */
  if (!isVariable) {
    const stock = Number(doc.stock ?? 0);
    const reserved = Math.max(0, Number(doc.reservedStock ?? 0));
    const available = Math.max(0, stock - reserved);
    doc.isInStock = available > 0;
    return;
  }

  /* ✅ VARIABLE PRODUCT */
  let anyVariantInStock = false;

  doc.variants = (doc.variants || []).map((v) => {
    const stock = Number(v.stock ?? 0);
    const reserved = Math.max(0, Number(v.reservedStock ?? 0));

    const available = Math.max(0, stock - reserved);
    const vInStock = available > 0;

    if (vInStock) anyVariantInStock = true;

    if (v && typeof v.set === "function") {
      v.set("isInStock", vInStock);
      return v;
    }

    return { ...v, isInStock: vInStock };
  });

  doc.isInStock = anyVariantInStock;
}

/**
 * ✅ PATCH:
 * - Always keep `colors` normalized
 * - If product-level colors already present, do NOT overwrite from variants
 * - If empty, optionally derive from variant attributes
 */
function computeColors(doc) {
  const normalize = (arr) =>
    Array.from(
      new Set(
        (arr || [])
          .map((c) => String(c || "").trim().toLowerCase())
          .filter(Boolean)
      )
    );

  if (Array.isArray(doc.colors) && doc.colors.length > 0) {
    doc.colors = normalize(doc.colors);
    return;
  }

  const isVariable = Array.isArray(doc.variants) && doc.variants.length > 0;
  if (!isVariable) {
    doc.colors = normalize(Array.isArray(doc.colors) ? doc.colors : []);
    return;
  }

  const set = new Set();
  (doc.variants || []).forEach((v) => {
    const attrs = Array.isArray(v.attributes) ? v.attributes : [];
    const color =
      attrs.find((a) => String(a?.key || "").toLowerCase() === "color")?.value ||
      "";
    if (color) set.add(String(color).trim().toLowerCase());
  });

  doc.colors = Array.from(set);
}

/* ------------------------------------------------------------------
HOOKS
------------------------------------------------------------------- */

// ✅ productType must be set BEFORE SKU logic
productSchema.pre("validate", function (next) {
  this.productType =
    Array.isArray(this.variants) && this.variants.length > 0
      ? "variable"
      : "simple";
  next();
});

// ✅ productCode auto increment
productSchema.pre("validate", async function (next) {
  try {
    if (!this.productCode) {
      const counter = await Counter.findOneAndUpdate(
        { name: "product" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      this.productCode = String(counter.seq).padStart(5, "0");
    }
    next();
  } catch (e) {
    next(e);
  }
});

/**
 * ✅ Model must NOT overwrite SKUs if they are already set by controller.
 */
productSchema.pre("validate", function (next) {
  try {
    const isVariable = Array.isArray(this.variants) && this.variants.length > 0;

    if (!isVariable && this.sku && String(this.sku).trim()) return next();

    if (
      isVariable &&
      Array.isArray(this.variants) &&
      this.variants.some((v) => v?.sku && String(v.sku).trim())
    ) {
      return next();
    }

    return next();
  } catch (e) {
    next(e);
  }
});

// ✅ Auto compute isInStock + colors on save
productSchema.pre("save", function (next) {
  try {
    computeInventoryFlags(this);
    computeColors(this);
    next();
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------
AUTO SET isPatternReady
If any variant has patternNumber -> true
Else -> false
------------------------------------------------------------------- */
productSchema.pre("validate", function (next) {
  try {
    const hasPattern =
      Array.isArray(this.variants) &&
      this.variants.some(
        (v) => v?.patternNumber && String(v.patternNumber).trim() !== ""
      );

    this.isPatternReady = !!hasPattern;

    next();
  } catch (e) {
    next(e);
  }
});

/**
 * ✅ Update hook:
 * - triggers when inventory OR colors touched
 * - recomputes isInStock + colors
 */
// ✅ helper: detect positional / arrayFilter updates that cause "conflict at variants"
const hasPositionalVariantUpdate = (obj = {}) =>
  Object.keys(obj || {}).some(
    (k) =>
      k.includes("variants.$.") ||
      k.includes("variants.$[") ||
      k.startsWith("variants.$")
  );

async function applyInventoryToUpdateQuery(next) {
  try {
    const update = this.getUpdate() || {};
    const $set = update.$set || {};
    const $inc = update.$inc || {};
    const $unset = update.$unset || {};

    if (
      hasPositionalVariantUpdate($set) ||
      hasPositionalVariantUpdate($inc) ||
      hasPositionalVariantUpdate($unset)
    ) {
      return next();
    }

    const touchesInventory =
      "stock" in update ||
      "variants" in update ||
      "reservedStock" in update ||
      "stock" in $set ||
      "variants" in $set ||
      "reservedStock" in $set ||
      Object.keys($set).some(
        (k) =>
          k.startsWith("variants.") || k === "stock" || k === "reservedStock"
      ) ||
      Object.keys($inc).some(
        (k) =>
          k.startsWith("variants.") || k === "stock" || k === "reservedStock"
      ) ||
      Object.keys($unset).some(
        (k) =>
          k.startsWith("variants.") || k === "stock" || k === "reservedStock"
      );

    const touchesColors =
      "colors" in update ||
      "colors" in $set ||
      Object.keys($set).some((k) => k === "colors" || k.startsWith("colors."));

    if (!touchesInventory && !touchesColors) return next();

    const current = await this.model.findOne(this.getQuery()).lean();
    if (!current) return next();

    const deepClone =
      typeof structuredClone === "function"
        ? structuredClone
        : (obj) => JSON.parse(JSON.stringify(obj));

    const merged = deepClone(current);

    // apply $set (nested paths)
    for (const [k, v] of Object.entries($set)) {
      const parts = k.split(".");
      let ref = merged;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!(p in ref)) ref[p] = /^\d+$/.test(parts[i + 1]) ? [] : {};
        ref = ref[p];
      }
      ref[parts[parts.length - 1]] = v;
    }

    // apply $inc
    for (const [k, v] of Object.entries($inc)) {
      const parts = k.split(".");
      let ref = merged;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!(p in ref)) ref[p] = /^\d+$/.test(parts[i + 1]) ? [] : {};
        ref = ref[p];
      }
      const last = parts[parts.length - 1];
      ref[last] = (ref[last] ?? 0) + v;
    }

    // apply $unset
    for (const k of Object.keys($unset)) {
      const parts = k.split(".");
      let ref = merged;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!(p in ref)) break;
        ref = ref[p];
      }
      delete ref[parts[parts.length - 1]];
    }

    const tempDoc = new this.model(merged);

    if (touchesInventory) computeInventoryFlags(tempDoc);
    if (touchesColors || touchesInventory) computeColors(tempDoc);

    update.$set = update.$set || {};

    if (touchesInventory) {
      update.$set.isInStock = tempDoc.isInStock;

      if (Array.isArray(tempDoc.variants) && tempDoc.variants.length) {
        tempDoc.variants.forEach((v, idx) => {
          update.$set[`variants.${idx}.isInStock`] = !!v.isInStock;
        });
      }
    }

    if (touchesColors || touchesInventory) {
      update.$set.colors = Array.isArray(tempDoc.colors) ? tempDoc.colors : [];
    }

    this.setUpdate(update);
    return next();
  } catch (e) {
    return next(e);
  }
}

productSchema.pre("findOneAndUpdate", applyInventoryToUpdateQuery);
productSchema.pre("updateOne", applyInventoryToUpdateQuery);
productSchema.pre("updateMany", applyInventoryToUpdateQuery);

/* ------------------------------------------------------------------
INDEXES
------------------------------------------------------------------- */
productSchema.index({ productCode: 1 }, { unique: true });
productSchema.index({ "variants.patternNumber": 1 });

// ✅ OPTIONAL: search in specs too
productSchema.index({ "specifications.key": 1 });

productSchema.index({
  title: "text",
  shortDescription: "text",
  howToStyle: "text",
  fabricDetails: "text",
});

productSchema.index({ keywords: 1 });
productSchema.index({ categories: 1 });
productSchema.index({ isActive: 1, isFeatured: 1 });
productSchema.index({ averageRating: -1 });
productSchema.index({ price: 1 });
productSchema.index({ sku: 1 }, { sparse: true });
productSchema.index({ "variants.sku": 1 }, { sparse: true });
productSchema.index({ tags: 1 });
productSchema.index({ "fabrics.fabricCode": 1 });
productSchema.index({ colors: 1 });

// ✅ NEW indexes
productSchema.index({ isPatternReady: 1 });
productSchema.index({ originalProductLink: 1 });
productSchema.index({ isTrending: 1 });

export default mongoose.models.Product || mongoose.model("Product", productSchema);