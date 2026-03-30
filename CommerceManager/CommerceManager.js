import mongoose from "mongoose";

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

const CommerceManagerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: "default",
      unique: true,
      index: true,
    },

    selectedProductCodes: {
      type: [String],
      default: [],
      set: (arr) => {
        if (!Array.isArray(arr)) return [];
        return [...new Set(arr.map(normalizeCode).filter(Boolean))];
      },
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },

    lastUpdatedAt: {
      type: Date,
      default: Date.now,
    },

    lastUpdatedBy: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

CommerceManagerSchema.methods.touch = function (updatedBy = "") {
  this.lastUpdatedAt = new Date();
  if (updatedBy) this.lastUpdatedBy = String(updatedBy).trim();
};

CommerceManagerSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({ name: "default" });

  if (!doc) {
    doc = await this.create({
      name: "default",
      selectedProductCodes: [],
      isActive: true,
      notes: "",
    });
  }

  return doc;
};

export default mongoose.model("CommerceManager", CommerceManagerSchema);