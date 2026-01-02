import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "Coupon code is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },

    type: {
      type: String,
      enum: ["general", "influencer", "system", "company"],
      default: "general",
      required: true,
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    discountType: {
      type: String,
      enum: ["percentage", "flat"],
      required: [true, "Discount type is required"],
    },

    discountValue: {
      type: Number,
      required: [true, "Discount value is required"],
      min: [0, "Discount cannot be negative"],
    },

    minPurchase: {
      type: Number,
      default: 0,
      min: [0, "Minimum purchase cannot be negative"],
    },

    maxDiscount: {
      type: Number,
      default: 0,
    },

    influencerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },

    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    validFrom: {
      type: Date,
      default: Date.now,
    },

    validTill: {
      type: Date,
      required: [true, "Coupon expiry date is required"],
    },

    usageLimit: {
      type: Number,
      default: 0,
    },

    usedCount: {
      type: Number,
      default: 0,
    },

    usageLimitPerCustomer: {
      type: Number,
      default: 1,
    },

    // ✅ FIXED: store Firebase UID / customerId as STRING
    usedBy: [
      {
        type: String,
        trim: true,
      },
    ],

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

couponSchema.pre("save", function (next) {
  if (this.validTill < new Date()) {
    this.isActive = false;
  }
  next();
});

couponSchema.index({ code: 1 });
couponSchema.index({ type: 1 });
couponSchema.index({ influencerId: 1 });
couponSchema.index({ validTill: 1 });

export default mongoose.model("Coupon", couponSchema);
