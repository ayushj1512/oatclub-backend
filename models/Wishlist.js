import mongoose from "mongoose";

const wishlistSchema = new mongoose.Schema(
  {
    firebaseUID: {
      type: String,
      required: true,
      index: true,
      unique: true,
      trim: true,
    },

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },

    // 🔥 Product IDs as STRING (temporary or permanent flexible structure)
    productIds: [
      {
        type: String,
        trim: true,
      },
    ],
  },
  { timestamps: true }
);

// Remove duplicates automatically
wishlistSchema.pre("save", function (next) {
  if (this.productIds?.length) {
    this.productIds = [...new Set(this.productIds)];
  }
  next();
});

// Indexes
wishlistSchema.index({ firebaseUID: 1 });
wishlistSchema.index({ customerId: 1 });

export default mongoose.model("Wishlist", wishlistSchema);
