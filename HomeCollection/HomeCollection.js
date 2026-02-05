import mongoose from "mongoose";

const HomeCollectionSchema = new mongoose.Schema(
  {
    imageUrl: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },

    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },

    // ✅ useful for homepage
    isActive: { type: Boolean, default: true, index: true },
    position: { type: Number, default: 0, index: true },
  },
  { timestamps: true }
);

export default mongoose.models.HomeCollection ||
  mongoose.model("HomeCollection", HomeCollectionSchema);
