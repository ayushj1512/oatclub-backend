import mongoose from "mongoose";

const marqueeItemSchema = new mongoose.Schema(
  {
    imageUrl: { type: String, required: true, trim: true },
    productCode: { type: String, required: true, trim: true, index: true },

    // optional controls
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0, index: true },
    alt: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

marqueeItemSchema.index({ isActive: 1, sortOrder: 1, createdAt: -1 });

export default mongoose.models.MarqueeItem || mongoose.model("MarqueeItem", marqueeItemSchema);