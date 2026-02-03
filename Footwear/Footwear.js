import mongoose from "mongoose";
import Counter from "../models/Counter.js";

const footwearVariantSchema = new mongoose.Schema(
  {
    patternNumber: { type: String, trim: true, default: "", index: true },

    attributes: [
      {
        attribute: { type: mongoose.Schema.Types.ObjectId, ref: "Attribute" },
        key: { type: String, trim: true },
        value: { type: String, trim: true },
      },
    ],

    size: { type: String, trim: true, default: "", index: true },
    color: { type: String, trim: true, default: "", lowercase: true, index: true },
    width: { type: String, trim: true, default: "" },

    sku: { type: String, unique: true, sparse: true, trim: true, index: true },
    barcode: { type: String, trim: true, default: "" },

    stock: { type: Number, default: 0 },
    isInStock: { type: Boolean, default: false },

    weight: { type: Number, default: 0 },
  },
  { _id: true, timestamps: false }
);

const footwearSchema = new mongoose.Schema(
  {
    // ✅ now prefixed: F00001
    footwearCode: { type: String, unique: true, required: true, index: true },

    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },

    description: { type: String, default: "" },
    shortDescription: { type: String, default: "" },
    highlights: [{ type: String }],

    categories: { type: [String], default: [] },
    collections: [{ type: mongoose.Schema.Types.ObjectId, ref: "Collection" }],

    tags: [{ type: String, trim: true, lowercase: true }],
    colors: [{ type: String, trim: true, lowercase: true, index: true }],

    price: { type: Number, required: true },
    compareAtPrice: { type: Number, default: null },
    currency: { type: String, default: "INR" },
    taxClass: { type: String, default: "standard" },

    sku: { type: String, unique: true, sparse: true, trim: true, index: true },
    stock: { type: Number, default: 0 },
    isInStock: { type: Boolean, default: false },

    hsnCode: {
      type: String,
      trim: true,
      default: "",
      index: true,
      validate: {
        validator: (v) => v === "" || /^\d+$/.test(v),
        message: "HSN code must contain digits only",
      },
    },

    footwear: {
      type: { type: String, trim: true, default: "", index: true },
      gender: { type: String, trim: true, default: "unisex", index: true },
      occasion: [{ type: String, trim: true, lowercase: true, index: true }],
      upperMaterial: [{ type: String, trim: true, lowercase: true, index: true }],
      liningMaterial: [{ type: String, trim: true, lowercase: true }],
      soleMaterial: [{ type: String, trim: true, lowercase: true, index: true }],
      closureType: { type: String, trim: true, default: "", index: true },
      heelType: { type: String, trim: true, default: "" },
      heelHeight: {
        value: { type: Number, min: 0, default: 0 },
        unit: { type: String, enum: ["cm", "inch"], default: "cm" },
      },
      careInstructions: { type: String, default: "" },
      countryOfOrigin: { type: String, trim: true, default: "" },
      sizeSystem: { type: String, enum: ["UK", "EU", "US", "IN"], default: "UK" },
      sizeRange: { min: { type: String, default: "" }, max: { type: String, default: "" } },
    },

    attributes: [
      { attribute: { type: mongoose.Schema.Types.ObjectId, ref: "Attribute" }, key: String, values: [String] },
    ],
    variants: [footwearVariantSchema],

    images: [{ type: String }],
    thumbnail: { type: String, default: "" },
    video: { type: String, default: "" },

    weight: { type: Number, default: 0 },
    dimensions: {
      length: { type: Number, default: 0 },
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
      unit: { type: String, default: "cm" },
    },

    averageRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: "Review" }],

    offer: { type: mongoose.Schema.Types.ObjectId, ref: "Offer", default: null },
    couponsApplicable: [{ type: mongoose.Schema.Types.ObjectId, ref: "Coupon" }],

    analytics: {
      views: { type: Number, default: 0 },
      purchases: { type: Number, default: 0 },
      wishlistCount: { type: Number, default: 0 },
      cartAdds: { type: Number, default: 0 },
      searchAppearances: { type: Number, default: 0 },
    },

    productType: { type: String, enum: ["simple", "variable"], default: "simple" },

    crossSellProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Footwear", index: true }],

    metaTitle: { type: String, default: "" },
    metaDescription: { type: String, default: "" },
    keywords: [{ type: String }],

    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    isDraft: { type: Boolean, default: false },
    publishAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

/* ---------- helpers ---------- */
function computeInventoryFlags(doc) {
  const isVariable = Array.isArray(doc.variants) && doc.variants.length > 0;

  if (!isVariable) {
    const inStock = (doc.stock ?? 0) > 0;
    doc.isInStock = inStock;
    if (!inStock) doc.isActive = false;
    return;
  }

  let any = false;
  doc.variants = (doc.variants || []).map((v) => {
    const vIn = (v.stock ?? 0) > 0;
    if (vIn) any = true;
    if (v?.set) v.set("isInStock", vIn);
    else v.isInStock = vIn;
    return v;
  });

  doc.isInStock = any;
  if (!any) doc.isActive = false;
}

function computeColors(doc) {
  const norm = (arr) =>
    Array.from(new Set((arr || []).map((c) => String(c || "").trim().toLowerCase()).filter(Boolean)));

  if (Array.isArray(doc.colors) && doc.colors.length) {
    doc.colors = norm(doc.colors);
    return;
  }

  if (!Array.isArray(doc.variants) || !doc.variants.length) {
    doc.colors = norm(doc.colors || []);
    return;
  }

  const set = new Set();
  doc.variants.forEach((v) => {
    const c = String(v?.color || "").trim().toLowerCase();
    if (c) set.add(c);
  });
  doc.colors = Array.from(set);
}

/* ---------- hooks ---------- */
footwearSchema.pre("validate", function (next) {
  this.productType = Array.isArray(this.variants) && this.variants.length ? "variable" : "simple";
  next();
});

// ✅ footwearCode: F00001
footwearSchema.pre("validate", async function (next) {
  try {
    if (this.footwearCode) return next();

    const counter = await Counter.findOneAndUpdate(
      { name: "footwear" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const padded = String(counter.seq).padStart(5, "0");
    this.footwearCode = `F${padded}`; // ✅ HERE
    next();
  } catch (e) {
    next(e);
  }
});

footwearSchema.pre("validate", function (next) {
  try {
    if (!Array.isArray(this.variants)) return next();

    this.variants = this.variants.map((v) => {
      const attrs = Array.isArray(v.attributes) ? v.attributes : [];
      const size =
        attrs.find((a) => String(a?.key || "").toLowerCase() === "size")?.value ||
        attrs.find((a) => String(a?.key || "").toLowerCase() === "sizes")?.value ||
        "";
      const color =
        attrs.find((a) => String(a?.key || "").toLowerCase() === "color")?.value ||
        attrs.find((a) => String(a?.key || "").toLowerCase() === "colour")?.value ||
        "";

      if (!String(v.size || "").trim() && size) v.size = String(size).trim();
      if (!String(v.color || "").trim() && color) v.color = String(color).trim().toLowerCase();
      return v;
    });

    next();
  } catch (e) {
    next(e);
  }
});

footwearSchema.pre("save", function (next) {
  try {
    computeInventoryFlags(this);
    computeColors(this);
    next();
  } catch (e) {
    next(e);
  }
});

/* ---------- indexes ---------- */
footwearSchema.index({ footwearCode: 1 }, { unique: true });
footwearSchema.index({ title: "text", description: "text" });
footwearSchema.index({ categories: 1 });
footwearSchema.index({ isActive: 1, isFeatured: 1 });
footwearSchema.index({ averageRating: -1 });
footwearSchema.index({ price: 1 });
footwearSchema.index({ sku: 1 }, { sparse: true });
footwearSchema.index({ "variants.sku": 1 }, { sparse: true });
footwearSchema.index({ "variants.patternNumber": 1 });
footwearSchema.index({ tags: 1 });
footwearSchema.index({ colors: 1 });
footwearSchema.index({ "footwear.type": 1 });
footwearSchema.index({ "footwear.gender": 1 });
footwearSchema.index({ "footwear.occasion": 1 });
footwearSchema.index({ "footwear.upperMaterial": 1 });
footwearSchema.index({ "footwear.soleMaterial": 1 });
footwearSchema.index({ "footwear.closureType": 1 });

export default mongoose.models.Footwear || mongoose.model("Footwear", footwearSchema);
