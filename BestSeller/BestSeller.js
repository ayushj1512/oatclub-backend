import mongoose from "mongoose";

const bestsellerSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      ref: "Product",
      index: true,
    },

    // ✅ order field (required for reorder)
    position: {
      type: Number,
      default: 0,
      index: true,
    },
  },
  { timestamps: true }
);

// helpful compound sort index
bestsellerSchema.index({ position: 1, createdAt: -1 });

export default mongoose.model("Bestseller", bestsellerSchema);
