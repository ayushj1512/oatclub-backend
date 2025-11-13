import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
      unique: true,
    },
    number: {
      type: Number,
      required: [true, "Category number is required"],
      unique: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true } // Adds createdAt and updatedAt
);

// Optional index for faster lookups
categorySchema.index({ name: 1 });
categorySchema.index({ number: 1 });

export default mongoose.model("Category", categorySchema);
