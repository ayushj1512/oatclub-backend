import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    /* ---------------------------------------------------------
       PRODUCT (REQUIRED)
    --------------------------------------------------------- */
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    /* ---------------------------------------------------------
       CUSTOMER (OPTIONAL FOR NOW)
       You can allow guest reviews later by disabling required
    --------------------------------------------------------- */
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },

    /* ---------------------------------------------------------
       RATING (1–5)
    --------------------------------------------------------- */
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },

    /* ---------------------------------------------------------
       OPTIONAL TITLE OF REVIEW
       (e.g., "Amazing quality!", "Perfect Fit", etc.)
    --------------------------------------------------------- */
    title: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "",
    },

    /* ---------------------------------------------------------
       LONG/TEXT REVIEW
    --------------------------------------------------------- */
    reviewText: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    /* ---------------------------------------------------------
       IMAGES (CLOUDINARY URLS)
       - supports multiple images
       - supports null values
    --------------------------------------------------------- */
    images: [
      {
        type: String,
        default: "",
      },
    ],

    /* ---------------------------------------------------------
       VERIFIED PURCHASE TAG
       - Mark when the user actually bought the product
    --------------------------------------------------------- */
    verifiedPurchase: {
      type: Boolean,
      default: false,
    },

    /* ---------------------------------------------------------
       STATUS:
       - pending (default)
       - approved (visible to customers)
       - rejected (hidden)
    --------------------------------------------------------- */
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
      index: true,
    },

    /* ---------------------------------------------------------
       ANALYTICS: HELPFUL / REPORT
       - For showing "X people found this helpful"
       - Customer can tap "Report this review"
    --------------------------------------------------------- */
    helpfulCount: {
      type: Number,
      default: 0,
    },

    reportedCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

/* ---------------------------------------------------------
   UNIQUE REVIEW RULE:
   A customer should review a product only once
--------------------------------------------------------- */
reviewSchema.index({ product: 1, customer: 1 }, { unique: true });

export default mongoose.models.Review ||
  mongoose.model("Review", reviewSchema);
