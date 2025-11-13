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
      default: 0, // 0 = no cap
    },

    influencerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer", // can reference influencer/user
      default: null,
    },

    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin", // optional, if you have an Admin/User model
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
      default: 0, // 0 = unlimited
    },

    usedCount: {
      type: Number,
      default: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Automatically deactivate expired coupons
couponSchema.pre("save", function (next) {
  if (this.validTill < new Date()) {
    this.isActive = false;
  }
  next();
});

// Index for faster searches and lookups
couponSchema.index({ code: 1 });
couponSchema.index({ type: 1 });
couponSchema.index({ influencerId: 1 });

export default mongoose.model("Coupon", couponSchema);
