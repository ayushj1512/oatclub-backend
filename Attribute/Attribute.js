import mongoose from "mongoose";

const attributeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },

    slug: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
    },

    type: {
      type: String,
      enum: ["text", "select", "multiselect", "color"],
      default: "select",
      required: true,
    },

    // Allowed values (only for select/multiselect/color)
    values: [
      {
        label: { type: String, required: true },
        value: { type: String, required: true },
      },
    ],

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Index for speed
attributeSchema.index({ name: "text", slug: "text" });

export default mongoose.models.Attribute ||
  mongoose.model("Attribute", attributeSchema);
