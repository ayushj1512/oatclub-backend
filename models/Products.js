import mongoose from "mongoose";
import { generateSKU } from "../utility/sku.js"; // ✅ adjust path if needed (utils/sku.js etc)

/* ------------------------------------------------------------------
   VARIANT LEVEL — supports ANY attribute combination (size/color/etc)
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

    sku: { type: String, unique: true, sparse: true, trim: true, index: true }, // ✅ SKU per variant
    barcode: { type: String, trim: true, default: "" },

    price: { type: Number, default: 0 },
    compareAtPrice: { type: Number, default: null },

    stock: { type: Number, default: 0 },
    isInStock: { type: Boolean, default: true },

    image: { type: String, trim: true, default: "" },
    weight: { type: Number, default: 0 },
  },
  { _id: true }
);

/* ------------------------------------------------------------------
   MAIN PRODUCT SCHEMA — BRAND REMOVED
------------------------------------------------------------------- */
const productSchema = new mongoose.Schema(
  {
    /* BASIC INFO */
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },

    description: { type: String, default: "" },
    shortDescription: { type: String, default: "" },
    highlights: [{ type: String }],

    /* CATEGORY */
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },

    subcategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },

    collections: [{ type: mongoose.Schema.Types.ObjectId, ref: "Collection" }],
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tag" }],

    /* PRICING */
    price: { type: Number, required: true },
    compareAtPrice: { type: Number, default: null },
    currency: { type: String, default: "INR" },
    taxClass: { type: String, default: "standard" },

    /* INVENTORY */
    sku: { type: String, unique: true, sparse: true, trim: true, index: true }, // ✅ SKU for simple product
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

    /* MEDIA */
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

/* AUTO SET PRODUCT TYPE */
productSchema.pre("save", function (next) {
  if (this.variants?.length > 0) {
    this.productType = "variable";
  } else {
    this.productType = "simple";
  }
  next();
});

/* ---------------------------------------------------------------
   ✅ AUTO-GENERATE SKUs (Product + Variants)
   - Simple product: product.sku
   - Variable product: each variant.sku
   Notes:
   - Category name is unknown at schema-level without populate,
     so we use "CAT" + product slug/title for generation.
   - For best SKU readability, generate again in controller
     when you have populated category name (optional).
---------------------------------------------------------------- */
productSchema.pre("validate", function (next) {
  try {
    // SIMPLE PRODUCT SKU
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

    // VARIABLE PRODUCT: ensure variant SKUs (do NOT set product.sku)
    if (Array.isArray(this.variants) && this.variants.length > 0) {
      this.variants = this.variants.map((v) => {
        if (v?.sku) return v;

        // Pull size/color from attributes if present
        const attrs = Array.isArray(v.attributes) ? v.attributes : [];
        const sizeAttr = attrs.find((a) => String(a.key || "").toLowerCase() === "size");
        const colorAttr = attrs.find((a) => String(a.key || "").toLowerCase() === "color");

        const size = sizeAttr?.value || "";
        const color = colorAttr?.value || "";

        return {
          ...v.toObject?.() ? v.toObject() : v,
          sku: generateSKU({
            brand: "MIR",
            category: "CAT",
            title: this.title || this.slug,
            size,
            color,
          }),
        };
      });
    }

    // Keep product-level sku empty for variable to avoid confusion
    this.sku = this.sku || undefined;

    next();
  } catch (e) {
    next(e);
  }
});

/* INDEXES */
productSchema.index({ title: "text", description: "text" });
productSchema.index({ keywords: 1 });
productSchema.index({ category: 1, subcategory: 1 });
productSchema.index({ isActive: 1, isFeatured: 1 });
productSchema.index({ averageRating: -1 });
productSchema.index({ price: 1 });

// Helpful SKU indexes (already in fields, but ok to be explicit)
productSchema.index({ sku: 1 }, { sparse: true });
productSchema.index({ "variants.sku": 1 }, { sparse: true });

export default mongoose.models.Product || mongoose.model("Product", productSchema);
