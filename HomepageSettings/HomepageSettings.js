import mongoose from "mongoose";

const heroBannerSchema = new mongoose.Schema(
  {
    image: { type: String, required: true, trim: true }, // Cloudinary URL
    link: { type: String, trim: true, default: "" }, // optional CTA link
    title: { type: String, trim: true, default: "" }, // optional internal title
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const categoryRowItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    // navigation type
    navigationType: {
      type: String,
      enum: ["collection", "category", "custom"],
      required: true,
      default: "category",
    },

    // used for category / collection navigation
    slug: { type: String, trim: true, default: "" },

    // used for custom navigation
    customRoute: { type: String, trim: true, default: "" },

    // optional legacy/support field
    tag: { type: String, trim: true, default: "" },

    // either image OR video
    image: { type: String, trim: true, default: "" },
    video: { type: String, trim: true, default: "" },

    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const homepageSettingsSchema = new mongoose.Schema(
  {
    // ideally only one doc in DB
    key: { type: String, default: "default", unique: true },

    heroBanners: { type: [heroBannerSchema], default: [] },
    categoryRow: { type: [categoryRowItemSchema], default: [] },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.models.HomepageSettings ||
  mongoose.model("HomepageSettings", homepageSettingsSchema);