import mongoose from "mongoose";

const offerSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Offer title is required"],
      trim: true,
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    // 🔹 Offer Type
    type: {
      type: String,
      enum: ["percentage", "flat"],
      required: [true, "Offer type is required"],
    },

    // 🔹 Discount Value
    discountValue: {
      type: Number,
      required: [true, "Discount value is required"],
      min: 0,
    },

    // 🔹 Applicable Scope
    applicableCategories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
      },
    ],

    applicableTags: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Tag",
      },
    ],

    applicableProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],

    minPurchaseAmount: {
      type: Number,
      default: 0,
    },

    maxDiscountAmount: {
      type: Number,
      default: null,
    },

    // 🔹 Validity
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },
    endDate: {
      type: Date,
      required: [true, "End date is required"],
    },

    // 🔹 Target Audience
    applicableTo: {
      type: String,
      enum: ["everyone", "new_users", "returning_users", "influencers"],
      default: "everyone",
    },

    influencerCode: {
      type: String,
      trim: true,
      default: null,
    },

    // 🔹 System Controls
    isActive: {
      type: Boolean,
      default: true,
    },

    createdBy: {
      type: String,
      trim: true,
      default: "system", // could also be admin ID later
    },
  },
  { timestamps: true }
);

// 🔹 Index for fast lookups
offerSchema.index({ isActive: 1 });
offerSchema.index({ startDate: 1, endDate: 1 });
offerSchema.index({ applicableCategories: 1 });
offerSchema.index({ applicableTags: 1 });

export default mongoose.model("Offer", offerSchema);
