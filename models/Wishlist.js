import mongoose from "mongoose";

const wishlistSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: [true, "Customer ID is required"],
      unique: true, // One wishlist per customer
    },
    productIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true,
      },
    ],
  },
  { timestamps: true }
);

// Index for fast lookups
wishlistSchema.index({ customerId: 1 });

export default mongoose.model("Wishlist", wishlistSchema);
