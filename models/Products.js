// models/Product.js
import mongoose from "mongoose";

// 🔹 Variant schema — subdocument for product variants
const variantSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true }, // e.g., Size, Color
    value: { type: String, trim: true }, // e.g., L, Red
    sku: { type: String, trim: true },
    price: { type: Number, default: 0 },
    stock: { type: Number, default: 0 },
    image: { type: String, trim: true },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    // 🔹 Basic Information
    title: {
      type: String,
      required: [true, "Product title is required"],
      trim: true,
    },
    slug: {
      type: String,
      required: [true, "Slug is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      required: true,
    },
    shortDescription: {
      type: String,
      trim: true,
    },

    // 🔹 Categorization
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category is required"],
    },
    tags: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Tag",
      },
    ],

    // 🔹 Pricing
    price: {
      type: Number,
      required: [true, "Product price is required"],
      min: 0,
    },
    compareAtPrice: {
      type: Number,
      default: null, // Old price for showing discounts
    },
    currency: {
      type: String,
      default: "INR",
    },

    // 🔹 Stock & Inventory
    sku: {
      type: String,
      unique: true,
      trim: true,
    },
    stock: {
      type: Number,
      default: 0,
    },
    isInStock: {
      type: Boolean,
      default: true,
    },
    variants: [variantSchema],

    // 🔹 Media
    images: [
      {
        type: String,
        required: true,
        trim: true,
      },
    ],
    thumbnail: {
      type: String,
      trim: true,
    },

    // 🔹 Ratings & Reviews — linked to Review model
    averageRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    totalReviews: {
      type: Number,
      default: 0,
    },
    reviews: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Review", // Reference external Review model
      },
    ],

    // 🔹 Offers and Coupons
    offer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Offer",
      default: null,
    },
    couponsApplicable: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Coupon",
      },
    ],

    // 🔹 Analytics
    analytics: {
      views: { type: Number, default: 0 },
      purchases: { type: Number, default: 0 },
      wishlistCount: { type: Number, default: 0 },
      cartAdds: { type: Number, default: 0 },
    },

    // 🔹 Additional Metadata
    brand: { type: String, trim: true },
    material: { type: String, trim: true },
    countryOfOrigin: { type: String, trim: true },
    weight: { type: Number, default: 0 },
    dimensions: {
      length: { type: Number, default: 0 },
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
      unit: { type: String, default: "cm" },
    },

    // 🔹 SEO / Discovery
    metaTitle: { type: String, trim: true },
    metaDescription: { type: String, trim: true },
    keywords: [{ type: String, trim: true, lowercase: true }],

    // 🔹 Status
    isActive: {
      type: Boolean,
      default: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// 🔹 Middleware: auto-calculate average rating from Review collection
productSchema.methods.updateRatings = async function () {
  const Review = mongoose.model("Review");

  const stats = await Review.aggregate([
    { $match: { product: this._id, status: "approved" } },
    {
      $group: {
        _id: "$product",
        avgRating: { $avg: "$rating" },
        totalReviews: { $sum: 1 },
      },
    },
  ]);

  if (stats.length > 0) {
    this.averageRating = Math.round(stats[0].avgRating * 10) / 10;
    this.totalReviews = stats[0].totalReviews;
  } else {
    this.averageRating = 0;
    this.totalReviews = 0;
  }

  await this.save();
};

// 🔹 Indexes for performance and full-text search
productSchema.index({ title: "text", description: "text", keywords: 1 });
productSchema.index({ category: 1 });
productSchema.index({ tags: 1 });
productSchema.index({ isActive: 1 });
productSchema.index({ averageRating: -1 });

export default mongoose.model("Product", productSchema);
