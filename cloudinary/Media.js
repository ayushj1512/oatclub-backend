import mongoose from "mongoose";

const mediaSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
    },

    publicId: {
      type: String,
      required: true,
      index: true,
    },

    // cloudinary_1 = existing account
    // cloudinary_2 = new active account
    cloudinarySource: {
      type: String,
      enum: ["cloudinary_1", "cloudinary_2"],
      default: "cloudinary_1",
      index: true,
    },

    cloudName: {
      type: String,
      default: "",
    },

    resourceType: {
      type: String,
      enum: ["image", "video", "raw"],
      default: "image",
    },

    format: {
      type: String,
      default: "",
    },

    bytes: {
      type: Number,
      default: 0,
    },

    width: {
      type: Number,
      default: 0,
    },

    height: {
      type: Number,
      default: 0,
    },

    folder: {
      type: String,
      default: "oatclub/media",
    },

    originalName: {
      type: String,
      default: "",
    },

    // Original Cloudinary upload date
    uploadedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Same publicId can exist in different Cloudinary accounts
mediaSchema.index(
  {
    cloudinarySource: 1,
    publicId: 1,
  },
  {
    unique: true,
  }
);

mediaSchema.index({
  uploadedAt: -1,
  createdAt: -1,
});

export default mongoose.models.Media ||
  mongoose.model("Media", mediaSchema);