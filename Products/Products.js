import mongoose from "mongoose";
import { generateSKU } from "../utility/sku.js";
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

  stock: { type: Number, default: 0 },
  isInStock: { type: Boolean, default: false },

  weight: { type: Number, default: 0 },
},
{ _id: true, timestamps: false }
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

  description: { type: String, default: "" },
  shortDescription: { type: String, default: "" },
  highlights: [{ type: String }],

  /* CATEGORIES / COLLECTIONS */
  categories: { type: [String], default: [] },
  collections: [{ type: mongoose.Schema.Types.ObjectId, ref: "Collection" }],

  /* TAGS */
  tags: [{ type: String, trim: true, lowercase: true }],

  /* PRICING (COMMON FOR ALL VARIANTS ✅) */
  price: { type: Number, required: true },
  compareAtPrice: { type: Number, default: null },
  currency: { type: String, default: "INR" },
  taxClass: { type: String, default: "standard" },

  /* INVENTORY (SIMPLE PRODUCT) */
  sku: { type: String, unique: true, sparse: true, trim: true, index: true },
  stock: { type: Number, default: 0 },
  // ✅ FIX: stock=0 implies not in stock
  isInStock: { type: Boolean, default: false },
/* HSN CODE (numeric-only) */
hsnCode: {
type: String,
trim: true,
default: "",
index: true,
validate: {
  validator: function (v) {
    // allow empty (optional), otherwise digits only
    return v === "" || /^\d+$/.test(v);
  },
  message: "HSN code must contain digits only",
},
},

  /* FABRICS (MULTIPLE ✅) — store by Fabric.code */
  fabrics: [
    {
      fabricCode: {
        type: String,
        trim: true,
        required: true,
        index: true,
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
  offer: { type: mongoose.Schema.Types.ObjectId, ref: "Offer", default: null },
  couponsApplicable: [{ type: mongoose.Schema.Types.ObjectId, ref: "Coupon" }],

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

  wordpressId: { type: Number, default: null },
},
{ timestamps: true }
);

/* ------------------------------------------------------------------
HELPERS
------------------------------------------------------------------- */
function computeInventoryFlags(doc) {
const isVariable = Array.isArray(doc.variants) && doc.variants.length > 0;

if (!isVariable) {
  const inStock = (doc.stock ?? 0) > 0;
  doc.isInStock = inStock;
  if (!inStock) doc.isActive = false; // ✅ auto-unpublish
  return;
}

let anyVariantInStock = false;

doc.variants = (doc.variants || []).map((v) => {
  const vInStock = (v.stock ?? 0) > 0;
  if (vInStock) anyVariantInStock = true;

  // if it's a mongoose subdoc, keep it compatible
  if (v && typeof v.set === "function") {
    v.set("isInStock", vInStock);
    return v;
  }
  return { ...v, isInStock: vInStock };
});

doc.isInStock = anyVariantInStock;
if (!anyVariantInStock) doc.isActive = false; // ✅ auto-unpublish
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

// ✅ SKU generation
productSchema.pre("validate", function (next) {
try {
  const isVariable = Array.isArray(this.variants) && this.variants.length > 0;

  // SIMPLE
  if (!isVariable) {
    if (!this.sku) {
      this.sku = generateSKU({
        brand: "MIR",
        category: "CAT",
        title: this.title || this.slug,
      });
    }
    return next();
  }

  // VARIABLE → VARIANT SKUs
  this.variants = this.variants.map((v) => {
    if (v?.sku) return v;

    const attrs = Array.isArray(v.attributes) ? v.attributes : [];
    const size =
      attrs.find((a) => a.key?.toLowerCase() === "size")?.value || "";
    const color =
      attrs.find((a) => a.key?.toLowerCase() === "color")?.value || "";

    return {
      ...v,
      sku: generateSKU({
        brand: "MIR",
        category: "CAT",
        title: this.title || this.slug,
        size,
        color,
      }),
    };
  });

  this.sku = undefined; // product-level sku not used for variable
  next();
} catch (e) {
  next(e);
}
});

// ✅ Auto compute isInStock + auto-unpublish on save
productSchema.pre("save", function (next) {
try {
  computeInventoryFlags(this);
  next();
} catch (e) {
  next(e);
}
});

/**
 * ✅ Handle update queries too (findOneAndUpdate / updateOne)
 * We read current doc, apply update in memory, compute flags,
 * then inject computed fields into the update payload.
 */
async function applyInventoryToUpdateQuery(next) {
try {
  const update = this.getUpdate() || {};
  const $set = update.$set || {};
  const $inc = update.$inc || {};
  const $unset = update.$unset || {};

  // If update doesn't touch stock/variants, skip
  const touchesInventory =
    "stock" in update ||
    "variants" in update ||
    "variants" in $set ||
    "stock" in $set ||
    Object.keys($set).some((k) => k.startsWith("variants.") || k === "stock") ||
    Object.keys($inc).some((k) => k.startsWith("variants.") || k === "stock") ||
    Object.keys($unset).some((k) => k.startsWith("variants.") || k === "stock");

  if (!touchesInventory) return next();

  // fetch current doc
  const current = await this.model.findOne(this.getQuery()).lean();
  if (!current) return next();

  // apply update roughly in memory (covers common patterns)
  const merged = structuredClone(current);

  // apply top-level direct fields
  Object.assign(merged, update);

  // apply $set
  for (const [k, v] of Object.entries($set)) {
    // handle nested paths like "variants.0.stock"
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

  // compute flags on a mongoose doc instance (so helper works same)
  const tempDoc = new this.model(merged);
  computeInventoryFlags(tempDoc);

  // inject computed flags back into update
  update.$set = update.$set || {};
  update.$set.isInStock = tempDoc.isInStock;

  // only force isActive false when out of stock
  if (!tempDoc.isInStock) update.$set.isActive = false;

  // also update variants.isInStock if variable
  if (Array.isArray(tempDoc.variants) && tempDoc.variants.length) {
    tempDoc.variants.forEach((v, idx) => {
      update.$set[`variants.${idx}.isInStock`] = !!v.isInStock;
    });
  }

  this.setUpdate(update);
  next();
} catch (e) {
  next(e);
}
}

productSchema.pre("findOneAndUpdate", applyInventoryToUpdateQuery);
productSchema.pre("updateOne", applyInventoryToUpdateQuery);
productSchema.pre("updateMany", applyInventoryToUpdateQuery); // optional

/* ------------------------------------------------------------------
INDEXES
------------------------------------------------------------------- */
productSchema.index({ productCode: 1 }, { unique: true });
productSchema.index({ "variants.patternNumber": 1 });
productSchema.index({ title: "text", description: "text" });
productSchema.index({ keywords: 1 });
productSchema.index({ categories: 1 });
productSchema.index({ isActive: 1, isFeatured: 1 });
productSchema.index({ averageRating: -1 });
productSchema.index({ price: 1 });
productSchema.index({ sku: 1 }, { sparse: true });
productSchema.index({ "variants.sku": 1 }, { sparse: true });
productSchema.index({ tags: 1 });
productSchema.index({ "fabrics.fabricCode": 1 });

export default mongoose.models.Product ||
mongoose.model("Product", productSchema);