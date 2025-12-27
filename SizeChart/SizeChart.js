// models/SizeChart.js
import mongoose from "mongoose";

const sizeChartSchema = new mongoose.Schema(
  {
    /* ---------------- BASIC ---------------- */
    title: {
      type: String,
      required: true,
      trim: true,
    },

    unit: {
      type: String,
      enum: ["cm", "inch"],
      default: "cm",
    },

    /* ---------------- TABLE STRUCTURE ---------------- */
    headers: [
      {
        type: String, // ["Size", "Bust", "Waist", "Length"]
        required: true,
        trim: true,
      },
    ],

    rows: [
      {
        type: [String], // ["S", "34", "28", "24"]
        required: true,
      },
    ],

    /* ---------------- CATEGORY ASSOCIATION ---------------- */
    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        index: true,
      },
    ],

    /* ---------------- OPTIONAL ---------------- */
    note: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

/* ---------------- INDEXES ---------------- */
sizeChartSchema.index({ title: "text" });
sizeChartSchema.index({ categories: 1 });

export default mongoose.models.SizeChart ||
  mongoose.model("SizeChart", sizeChartSchema);
