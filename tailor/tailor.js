import mongoose from "mongoose";

const tailorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    type: {
      type: String,
      enum: [
        "sample_tailor",        // sampling master
        "pattern_master",       // pattern making
        "cutting_master",       // fabric cutting
        "stitching_tailor",     // main stitching
        "finishing_tailor",     // finishing work
        "alteration_tailor",    // alterations
        "karigar",              // general skilled worker
        "embroidery_tailor",    // embroidery work
        "all",                  // multi-skill
      ],
      default: "all",
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    mobile: {
      type: String,
      trim: true,
      default: "",
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },

    rating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0,
    },

    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Tailor", tailorSchema);