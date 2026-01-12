import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "Coupon code is required"],
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["general", "influencer", "system", "company"],
      default: "general",
      required: true,
      index: true,
    },

    description: { type: String, trim: true, default: "" },

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

    // if 0 => no cap
    maxDiscount: { type: Number, default: 0, min: 0 },

    influencerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },

    issuedBy: { type: mongoose.Schema.Types.ObjectId, default: null },

    validFrom: { type: Date, default: Date.now },
    validTill: { type: Date, required: [true, "Coupon expiry date is required"], index: true },

    // if 0 => unlimited (global)
    usageLimit: { type: Number, default: 0, min: 0 },
    usedCount: { type: Number, default: 0, min: 0 },

    // if 0 => unlimited per customer
    usageLimitPerCustomer: { type: Number, default: 1, min: 0 },

    // Store customer identifier (email/uid) as normalized lowercase string
    usedBy: [{ type: String, trim: true, lowercase: true }],

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Keep isActive in sync with expiry (save + updates)
couponSchema.pre("save", function (next) {
  this.isActive = this.validTill >= new Date();
  next();
});

couponSchema.pre(["findOneAndUpdate", "updateOne", "updateMany"], function (next) {
  const u = this.getUpdate() || {};
  const set = u.$set || u;
  if (set.validTill) {
    const vt = new Date(set.validTill);
    this.setUpdate({
      ...u,
      $set: { ...(u.$set || {}), isActive: vt >= new Date() },
    });
  }
  next();
});

// Helpful compound indexes (optional but good)
couponSchema.index({ isActive: 1, validTill: 1 });
couponSchema.index({ code: 1, isActive: 1 });

export default mongoose.models.Coupon || mongoose.model("Coupon", couponSchema);
