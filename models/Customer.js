import mongoose from "mongoose";

const customerSchema = new mongoose.Schema(
  {
    firebaseUID: {
      type: String,
      required: [true, "Firebase UID is required"],
      unique: true,
      trim: true,
    },

    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      unique: true,
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    profileImage: {
      type: String,
      default: "",
    },

    dateOfBirth: {
      type: Date,
      default: null,
    },

    gender: {
      type: String,
      enum: ["male", "female", "non_binary", "prefer_not_to_say"],
      default: "prefer_not_to_say",
    },

    ageGroup: {
      type: String,
      enum: ["Gen Alpha", "Gen Z", "Millennial", "Gen X", "Boomer", "Unknown"],
      default: "Unknown",
    },

    country: {
      type: String,
      trim: true,
      default: "India",
    },

    state: {
      type: String,
      trim: true,
      default: "",
    },

    city: {
      type: String,
      trim: true,
      default: "",
    },

    referralCode: {
      type: String,
      trim: true,
      default: "",
    },

    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },

    preferences: {
      categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
      favoriteBrands: [{ type: String, trim: true }],
      budgetRange: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
    },

    analytics: {
      totalOrders: { type: Number, default: 0 },
      totalSpend: { type: Number, default: 0 },
      avgOrderValue: { type: Number, default: 0 },
      wishlistCount: { type: Number, default: 0 },
      couponUses: { type: Number, default: 0 },
      creditsEarned: { type: Number, default: 0 },
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Auto-determine ageGroup when DOB is set
customerSchema.pre("save", function (next) {
  if (this.dateOfBirth) {
    const age = Math.floor(
      (Date.now() - this.dateOfBirth.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    );

    if (age <= 13) this.ageGroup = "Gen Alpha";
    else if (age <= 27) this.ageGroup = "Gen Z";
    else if (age <= 42) this.ageGroup = "Millennial";
    else if (age <= 57) this.ageGroup = "Gen X";
    else if (age <= 75) this.ageGroup = "Boomer";
    else this.ageGroup = "Unknown";
  }
  next();
});

// Index for quick lookups
customerSchema.index({ email: 1 });
customerSchema.index({ firebaseUID: 1 });
customerSchema.index({ ageGroup: 1 });
customerSchema.index({ country: 1 });

export default mongoose.model("Customer", customerSchema);
