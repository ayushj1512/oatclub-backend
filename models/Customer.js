import mongoose from "mongoose";

const customerSchema = new mongoose.Schema(
  {
    // 🔐 Only reliable required value from Firebase Auth
    firebaseUID: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // 👤 Basic Profile — optional for OAuth
    name: {
      type: String,
      trim: true,
      default: "",
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
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

    // 🎂 Optional data (customer may fill later)
    dateOfBirth: {
      type: Date,
      default: null,
    },

    gender: {
      type: String,
      enum: ["male", "female", "non_binary", "prefer_not_to_say", "unknown"],
      default: "unknown",
    },

    ageGroup: {
      type: String,
      enum: ["Gen Alpha", "Gen Z", "Millennial", "Gen X", "Boomer", "Unknown"],
      default: "Unknown",
    },

    // 🌍 Location fields — optional & editable anytime
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

    // 🧩 Referral system
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

    // ❤️ Preferences (user may fill/update later)
    preferences: {
      categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
      favoriteBrands: [{ type: String, trim: true }],
      budgetRange: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
    },

    // 📊 Analytics — always optional & auto-calculated
    analytics: {
      totalOrders: { type: Number, default: 0 },
      totalSpend: { type: Number, default: 0 },
      avgOrderValue: { type: Number, default: 0 },
      wishlistCount: { type: Number, default: 0 },
      couponUses: { type: Number, default: 0 },
      creditsEarned: { type: Number, default: 0 },
    },

    // 🚀 Account status
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

// Automatically set age group when DOB is added
customerSchema.pre("save", function (next) {
  if (this.dateOfBirth) {
    const age = Math.floor(
      (Date.now() - this.dateOfBirth.getTime()) /
        (365.25 * 24 * 60 * 60 * 1000)
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

// Indexes for fast querying
customerSchema.index({ firebaseUID: 1 });
customerSchema.index({ email: 1 });
customerSchema.index({ ageGroup: 1 });
customerSchema.index({ country: 1 });

export default mongoose.models.Customer ||
  mongoose.model("Customer", customerSchema);
