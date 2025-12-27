import mongoose from "mongoose";

const blogSchema = new mongoose.Schema(
  {
    // ✅ Same as frontend
    slug: {
      type: String,
      required: [true, "Slug is required"],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    title: {
      type: String,
      required: [true, "Blog title is required"],
      trim: true,
    },

    excerpt: {
      type: String,
      default: "",
      trim: true,
    },

    date: {
      // frontend: "YYYY-MM-DD"
      type: String,
      default: "",
      trim: true,
    },

    category: {
      type: String,
      default: "",
      trim: true,
    },

    // frontend uses `tags: []` (not hashtags)
    tags: [
      {
        type: String,
        trim: true,
      },
    ],

    image: {
      type: String,
      default: "",
      trim: true,
    },

    // can be "" for preview blogs
    content: {
      type: String,
      default: "",
    },

    // ✅ NEW: Related Products (for blogs on products)
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        index: true,
      },
    ],

    // optional
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },

    isPublished: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

// ✅ Search index
blogSchema.index({
  title: "text",
  excerpt: "text",
  content: "text",
  category: "text",
  tags: 1,
});

export default mongoose.models.Blog || mongoose.model("Blog", blogSchema);
