// models/Collection.js
import mongoose from "mongoose";

const collectionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
    },

    bannerImage: {
      type: String, // Cloudinary URL
      default: "",
    },

    thumbnailImage: {
      type: String, // Cloudinary URL
      default: "",
    },

    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],

    tags: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Tag",
      },
    ],

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    launchDate: {
      type: Date,
      default: Date.now,
    },

    expiryDate: {
      type: Date,
    },

    type: {
      type: String,
      enum: ["seasonal", "influencer", "brand", "custom"],
      default: "seasonal",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin", // or "User" if you don’t have admin model yet
    },

    analytics: {
      views: {
        type: Number,
        default: 0,
      },
      clicks: {
        type: Number,
        default: 0,
      },
      conversions: {
        type: Number,
        default: 0,
      },
    },
  },
  { timestamps: true }
);

export default mongoose.model("Collection", collectionSchema);
