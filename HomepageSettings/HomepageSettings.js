import mongoose from "mongoose";

const heroBannerSchema = new mongoose.Schema(
  {
    desktopImage: { type: String, required: true, trim: true }, // Desktop banner
    mobileImage: { type: String, required: true, trim: true }, // Mobile banner

    link: { type: String, trim: true, default: "" },
    title: { type: String, trim: true, default: "" },

    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const categoryRowItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    navigationType: {
      type: String,
      enum: ["collection", "category", "custom"],
      required: true,
      default: "category",
    },

    slug: { type: String, trim: true, default: "" },
    customRoute: { type: String, trim: true, default: "" },
    tag: { type: String, trim: true, default: "" },

    image: { type: String, trim: true, default: "" },
    video: { type: String, trim: true, default: "" },

    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const categoryBannerSchema = new mongoose.Schema(
  {
    categoryName: { type: String, required: true, trim: true },
    categorySlug: { type: String, required: true, trim: true },

    title: { type: String, trim: true, default: "" },
    subtitle: { type: String, trim: true, default: "" },

    image: { type: String, required: true, trim: true }, // single banner only

    link: { type: String, trim: true, default: "" },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const homepageSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },

    heroBanners: { type: [heroBannerSchema], default: [] },
    categoryRow: { type: [categoryRowItemSchema], default: [] },
    categoryBanners: { type: [categoryBannerSchema], default: [] },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.models.HomepageSettings ||
  mongoose.model("HomepageSettings", homepageSettingsSchema);