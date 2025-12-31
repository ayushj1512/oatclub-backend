import mongoose from "mongoose";

const heroBannerSchema = new mongoose.Schema(
  {
    image: { type: String, required: true, trim: true }, // Cloudinary URL
    link: { type: String, trim: true, default: "" },     // optional CTA link
    title: { type: String, trim: true, default: "" },    // optional internal title
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const categoryRowItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    // Either slug OR tag (based on your current UI)
    slug: { type: String, trim: true, default: "" },
    tag: { type: String, trim: true, default: "" },

    // Either image OR video
    image: { type: String, trim: true, default: "" },
    video: { type: String, trim: true, default: "" },

    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const homepageSettingsSchema = new mongoose.Schema(
  {
    // Only one doc will exist in DB ideally
    key: { type: String, default: "default", unique: true },

    heroBanners: { type: [heroBannerSchema], default: [] },
    categoryRow: { type: [categoryRowItemSchema], default: [] },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // optional
  },
  { timestamps: true }
);

export default mongoose.models.HomepageSettings ||
  mongoose.model("HomepageSettings", homepageSettingsSchema);
