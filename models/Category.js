import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    /* -------------------------------------------------------
       BASIC DISPLAY INFORMATION
    ------------------------------------------------------- */
    name: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
      unique: true,
    },

    slug: {
      type: String,
      required: [true, "Category slug is required"],
      lowercase: true,
      unique: true,
      trim: true,
    },

    /* -------------------------------------------------------
       SORTING & NUMBERING
    ------------------------------------------------------- */
    sortOrder: {
      type: Number,
      default: 0,
    },

    number: {
      type: Number,
      unique: true,
      sparse: true, // allows null values
    },

    /* -------------------------------------------------------
       CONTENT FIELDS
    ------------------------------------------------------- */
    description: {
      type: String,
      default: "",
      trim: true,
    },

    image: {
      type: String,
      default: "", // banner image
    },

    icon: {
      type: String,
      default: "", // small icon for menus
    },

    /* -------------------------------------------------------
       HIERARCHY (Category → Subcategory)
    ------------------------------------------------------- */
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },

    /* -------------------------------------------------------
       VISIBILITY FLAGS
    ------------------------------------------------------- */
    isFeatured: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    /* -------------------------------------------------------
       SEO (for Google / WP migration)
    ------------------------------------------------------- */
    metaTitle: {
      type: String,
      trim: true,
    },

    metaDescription: {
      type: String,
      trim: true,
    },

    keywords: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],

    /* -------------------------------------------------------
       CATEGORY-BASED FILTER ATTRIBUTE IDS
    ------------------------------------------------------- */
    attributes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Attribute",
      },
    ],
  },
  { timestamps: true }
);

/* -------------------------------------------------------
   INDEXES → SPEED 🔥
------------------------------------------------------- */
categorySchema.index({ name: "text", slug: "text" });
categorySchema.index({ parent: 1 });
categorySchema.index({ sortOrder: 1 });
categorySchema.index({ isActive: 1 });
categorySchema.index({ isFeatured: 1 });

export default mongoose.models.Category ||
  mongoose.model("Category", categorySchema);
