import mongoose from "mongoose";

/* =========================================================
   HERO BANNER
========================================================= */

const heroBannerSchema = new mongoose.Schema(
  {
    image: {
      type: String,
      required: true,
      trim: true,
    },

    link: {
      type: String,
      trim: true,
      default: "",
    },

    title: {
      type: String,
      trim: true,
      default: "",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { _id: true }
);

/* =========================================================
   CATEGORY ROW ITEM
========================================================= */

const categoryRowItemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    navigationType: {
      type: String,
      enum: ["collection", "category", "custom"],
      required: true,
      default: "category",
    },

    slug: {
      type: String,
      trim: true,
      default: "",
    },

    customRoute: {
      type: String,
      trim: true,
      default: "",
    },

    tag: {
      type: String,
      trim: true,
      default: "",
    },

    image: {
      type: String,
      trim: true,
      default: "",
    },

    video: {
      type: String,
      trim: true,
      default: "",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { _id: true }
);

/* =========================================================
   CATEGORY BANNER
========================================================= */

const categoryBannerSchema = new mongoose.Schema(
  {
    categoryName: {
      type: String,
      required: true,
      trim: true,
    },

    categorySlug: {
      type: String,
      required: true,
      trim: true,
    },

    title: {
      type: String,
      trim: true,
      default: "",
    },

    subtitle: {
      type: String,
      trim: true,
      default: "",
    },

    image: {
      type: String,
      required: true,
      trim: true,
    },

    link: {
      type: String,
      trim: true,
      default: "",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { _id: true }
);

/* =========================================================
   HOMEPAGE SETTINGS
========================================================= */

const homepageSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "default",
      unique: true,
      trim: true,
    },

    /**
     * Desktop and mobile banners are stored separately.
     *
     * Example:
     * desktopHeroBanners: 3 banners
     * mobileHeroBanners: 4 banners
     */
    desktopHeroBanners: {
      type: [heroBannerSchema],
      default: [],
    },

    mobileHeroBanners: {
      type: [heroBannerSchema],
      default: [],
    },

    categoryRow: {
      type: [categoryRowItemSchema],
      default: [],
    },

    categoryBanners: {
      type: [categoryBannerSchema],
      default: [],
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/* =========================================================
   NORMALIZE SORT ORDER
========================================================= */

homepageSettingsSchema.pre("save", function () {
  const sortItems = (items = []) =>
    items.sort(
      (firstItem, secondItem) =>
        Number(firstItem.sortOrder || 0) -
        Number(secondItem.sortOrder || 0)
    );

  this.desktopHeroBanners = sortItems(this.desktopHeroBanners);
  this.mobileHeroBanners = sortItems(this.mobileHeroBanners);
  this.categoryRow = sortItems(this.categoryRow);
  this.categoryBanners = sortItems(this.categoryBanners);
});

/* =========================================================
   MODEL
========================================================= */

const HomepageSettings =
  mongoose.models.HomepageSettings ||
  mongoose.model("HomepageSettings", homepageSettingsSchema);

export default HomepageSettings;