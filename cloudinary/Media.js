import mongoose from "mongoose";

const mediaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true, index: true, unique: true },
    resourceType: { type: String, enum: ["image", "video", "raw"], default: "image" },
    format: { type: String, default: "" },
    bytes: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    folder: { type: String, default: "miray/media" },
    originalName: { type: String, default: "" },
  },
  { timestamps: true }
);

mediaSchema.index({ createdAt: -1 });

export default mongoose.models.Media || mongoose.model("Media", mediaSchema);
