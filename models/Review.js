// models/Review.js
import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    // 🧩 Link to the product being reviewed
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    // 👤 Link to the customer who posted the review
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },

    // 🌟 Rating value (1 to 5)
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },

    // 📝 Short review text
    reviewText: {
      type: String,
      trim: true,
      maxlength: 1000,
    },

    // 🖼️ Array of review images (Cloudinary URLs)
    images: [
      {
        type: String,
        default: "",
      },
    ],

    // ✅ Whether this review is from a verified purchase
    verifiedPurchase: {
      type: Boolean,
      default: false,
    },

    // 🕵️‍♀️ For moderation or analytics
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
    },

    // 🧠 Optional metadata for analytics
    helpfulCount: {
      type: Number,
      default: 0,
    },
    reportedCount: {
      type: Number,
      default: 0,
    },

    // 📅 Timestamp for audit and sorting
  },
  { timestamps: true }
);

// 🔹 Ensure a customer reviews a product only once (optional rule)
reviewSchema.index({ product: 1, customer: 1 }, { unique: true });

export default mongoose.model("Review", reviewSchema);
