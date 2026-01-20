import mongoose from "mongoose";

const bestsellerSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      ref: "Product",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Bestseller", bestsellerSchema);
