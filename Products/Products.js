import mongoose from "mongoose";
import { generateSKU } from "../utility/sku.js";
import Counter from "../models/Counter.js";

/* ------------------------------------------------------------------
   VARIANT SCHEMA (NO IMAGES ❌)
------------------------------------------------------------------- */
const variantSchema = new mongoose.Schema(
  {
    attributes: [
      {
        attribute: { type: mongoose.Schema.Types.ObjectId, ref: "Attribute" },
        key: { type: String, trim: true },
        value: { type: String, trim: true },
      },
    ],

    sku: { type: String, unique: true, sparse: true, trim: true, index: true },
    barcode: { type: String, trim: true, default: "" },

    price: { type: Number, default: 0 },
    compareAtPrice: { type: Number, default: null },

    stock: { type: Number, default: 0 },
    isInStock: { type: Boolean, default: true },

    weight: { type: Number, default: 0 },
  },
  { _id: true, timestamps: false }
);

/* ------------------------------------------------------------------
   MAIN PRODUCT SCHEMA
------------------------------------------------------------------- */
const productSchema = new mongoose.Schema(
  {
    /* SEQUENTIAL PRODUCT CODE */
    productCode: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },

    /* BASIC INFO */
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },

    description: { type: String, default: "" },
    shortDescription: { type: String, default: "" },
    highlights: [{ type: String }],

    /* CATEGORIES */
    categories: {
      type: [String],
      default: [],
    },

    collections: [{ type: mongoose.Schema.Types.ObjectId, ref: "Collection" }],

    /* TAGS */
    tags: [{ type: String, trim: true, lowercase: true }],

    /* PRICING */
    price: { type: Number, required: true },
    compareAtPrice: { type: Number, default: null },
    currency: { type: String, default: "INR" },
    taxClass: { type: String, default: "standard" },

    /* INVENTORY (SIMPLE PRODUCT) */
    sku: { type: String, unique: true, sparse: true, trim: true, index: true },
    stock: { type: Number, default: 0 },
    isInStock: { type: Boolean, default: true },

    /* ATTRIBUTES + VARIANTS */
    attributes: [
      {
        attribute: { type: mongoose.Schema.Types.ObjectId, ref: "Attribute" },
        key: String,
        values: [String],
      },
    ],

    variants: [variantSchema],

    /* MEDIA (PRODUCT LEVEL ONLY ✅) */
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
    
  /* CROSS SELL PRODUCTS */
    crossSellProducts: [
  {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    index: true,
  },
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
   AUTO SET PRODUCT TYPE
------------------------------------------------------------------- */
productSchema.pre("save", function (next) {
  this.productType =
    Array.isArray(this.variants) && this.variants.length > 0
      ? "variable"
      : "simple";
  next();
});

/* ------------------------------------------------------------------
   AUTO-GENERATE PRODUCT CODE
------------------------------------------------------------------- */
productSchema.pre("validate", async function (next) {
  try {
    if (!this.productCode) {
      const counter = await Counter.findOneAndUpdate(
        { id: "product" },
        { $inc: { sequence: 1 } },
        { new: true, upsert: true }
      );
      this.productCode = String(counter.sequence).padStart(5, "0");
    }
    next();
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------
   AUTO-GENERATE SKUs
------------------------------------------------------------------- */
productSchema.pre("validate", function (next) {
  try {
    // SIMPLE PRODUCT
    if (this.productType !== "variable" || !this.variants?.length) {
      if (!this.sku) {
        this.sku = generateSKU({
          brand: "MIR",
          category: "CAT",
          title: this.title || this.slug,
        });
      }
      return next();
    }

    // VARIABLE PRODUCT → VARIANT SKUs
    this.variants = this.variants.map((v) => {
      if (v?.sku) return v;

      const attrs = Array.isArray(v.attributes) ? v.attributes : [];
      const size = attrs.find((a) => a.key?.toLowerCase() === "size")?.value || "";
      const color = attrs.find((a) => a.key?.toLowerCase() === "color")?.value || "";

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

    this.sku = undefined;
    next();
  } catch (e) {
    next(e);
  }
});

/* INDEXES */
productSchema.index({ productCode: 1 }, { unique: true });
productSchema.index({ title: "text", description: "text" });
productSchema.index({ keywords: 1 });
productSchema.index({ categories: 1 });
productSchema.index({ isActive: 1, isFeatured: 1 });
productSchema.index({ averageRating: -1 });
productSchema.index({ price: 1 });
productSchema.index({ sku: 1 }, { sparse: true });
productSchema.index({ "variants.sku": 1 }, { sparse: true });
productSchema.index({ tags: 1 });

export default mongoose.models.Product ||
  mongoose.model("Product", productSchema);
