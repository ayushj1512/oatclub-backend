import mongoose from "mongoose";

/* ---------------------------------------------------------------
  COLLABORATION SCHEMA (ONGOING)
---------------------------------------------------------------- */
const collaborationSchema = new mongoose.Schema(
  {
    influencer: {
      influencerId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        index: true,
      },
      name: { type: String, required: true, trim: true, index: true },
      state: { type: String, trim: true, default: "", index: true },
      address: { type: String, trim: true, default: "" },
      links: [{ type: String, trim: true }],
    },

    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    platform: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      enum: [
        "instagram",
        "youtube",
        "facebook",
        "snapchat",
        "twitter",
        "linkedin",
        "website",
        "other",
      ],
      index: true,
    },

    status: {
      type: String,
      enum: ["ongoing", "completed", "cancelled"],
      default: "ongoing",
      index: true,
    },

    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

/* ---------------------------------------------------------------
  INDEXES
  - Prevent duplicate ONGOING collab for same product+platform+influencer(name)
---------------------------------------------------------------- */
collaborationSchema.index(
  { productId: 1, platform: 1, "influencer.name": 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "ongoing" },
  }
);

collaborationSchema.index({ status: 1, createdAt: -1 });
collaborationSchema.index({ "influencer.name": 1 });

export default mongoose.models.Collaboration ||
  mongoose.model("Collaboration", collaborationSchema);
