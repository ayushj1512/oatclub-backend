import mongoose from "mongoose";

// --- helpers ---
const normalizeEmail = (v) => (v ? String(v).trim().toLowerCase() : null);

// Store phone as digits only (E.164-ish without +). e.g. "+91 98765-43210" => "919876543210"
const normalizePhone = (v) => {
  if (!v) return null;
  const digits = String(v).replace(/\D/g, "");
  return digits.length ? digits : null;
};

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

    // ✅ NEW: visibility
    // public  => show for general public (list/auto-suggest etc.)
    // private => hidden (usable only when code is entered)
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public",
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
    validTill: {
      type: Date,
      required: [true, "Coupon expiry date is required"],
      index: true,
    },

    // if 0 => unlimited (global)
    usageLimit: { type: Number, default: 0, min: 0 },
    usedCount: { type: Number, default: 0, min: 0 },

    // if 0 => unlimited per customer
    usageLimitPerCustomer: { type: Number, default: 1, min: 0 },

    // Store customer identifier (email/uid) as normalized lowercase string
    usedBy: [{ type: String, trim: true, lowercase: true }],

    // optional targeting
    targetEmail: { type: String, trim: true, lowercase: true, default: null, index: true },
    targetPhone: { type: String, trim: true, default: null, index: true }, // digits only

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Normalize target fields (save)
couponSchema.pre("save", function (next) {
  this.isActive = this.validTill >= new Date();

  if (this.targetEmail !== undefined) this.targetEmail = normalizeEmail(this.targetEmail);
  if (this.targetPhone !== undefined) this.targetPhone = normalizePhone(this.targetPhone);

  next();
});

// Normalize target fields (updates) + keep isActive in sync
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

  if (set.targetEmail !== undefined) set.targetEmail = normalizeEmail(set.targetEmail);
  if (set.targetPhone !== undefined) set.targetPhone = normalizePhone(set.targetPhone);

  if (u.$set) u.$set = set;
  else Object.assign(u, set);

  next();
});

// Helpful indexes
couponSchema.index({ isActive: 1, validTill: 1 });
couponSchema.index({ code: 1, isActive: 1 });

// ✅ for listing public coupons fast
couponSchema.index({ visibility: 1, isActive: 1, validTill: 1 });

// Optional: speeds up “find coupon for this customer”
couponSchema.index({ code: 1, targetEmail: 1, isActive: 1 });
couponSchema.index({ code: 1, targetPhone: 1, isActive: 1 });

export default mongoose.models.Coupon || mongoose.model("Coupon", couponSchema);
