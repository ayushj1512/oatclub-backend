import mongoose from "mongoose";

const blogSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Blog title is required"],
      trim: true,
    },
    slug: {
      type: String,
      required: [true, "Slug is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    hashtags: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    image: {
      type: String,
      default: "",
      trim: true,
    },
    content: {
      type: String,
      required: [true, "Blog content is required"],
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer", // or "User" if you have a separate user/admin model
      default: null,
    },
    isPublished: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Text index for search (useful for analytics & search features)
blogSchema.index({ title: "text", content: "text", hashtags: 1 });

export default mongoose.model("Blog", blogSchema);
