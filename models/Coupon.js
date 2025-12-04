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

    // DISCOUNT
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
      default: 0, // 0 = no cap
    },

    // TARGETING
    influencerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },

    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // VALIDITY
    validFrom: {
      type: Date,
      default: Date.now,
    },

    validTill: {
      type: Date,
      required: [true, "Coupon expiry date is required"],
    },

    // USAGE LIMITS
    usageLimit: {
      type: Number,
      default: 0, // 0 = unlimited global usage
    },

    usedCount: {
      type: Number,
      default: 0,
    },

    // 🔥 NEW — Only once per customer
    usageLimitPerCustomer: {
      type: Number,
      default: 1, // allow once per user
    },

    // 🔥 NEW — Track which customers have used it
    usedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Customer",
      },
    ],

    // STATUS
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// 🔥 Auto-deactivate expired coupons
couponSchema.pre("save", function (next) {
  if (this.validTill < new Date()) {
    this.isActive = false;
  }
  next();
});

// 🔥 Indexes for performance
couponSchema.index({ code: 1 });
couponSchema.index({ type: 1 });
couponSchema.index({ influencerId: 1 });
couponSchema.index({ validTill: 1 });

export default mongoose.model("Coupon", couponSchema);
