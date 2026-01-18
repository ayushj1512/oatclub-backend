import mongoose from "mongoose";
import Counter from "../models/Counter.js";

/**
 * ✅ Customer Schema
 */
const customerSchema = new mongoose.Schema(
  {
    // ✅ Customer ID like 0001, 0002...
    customerId: {
      type: String,
      unique: true,
      index: true,
    },

    /**
     * 🔐 Firebase UID — OPTIONAL (guest checkout allowed)
     * ✅ No default null (important!)
     */
    firebaseUID: {
      type: String,
      trim: true,
      index: true,
    },

    // 👤 Basic Profile
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
      index: true,
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

    // 🎂 Optional
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

    // 🌍 Location
    country: { type: String, trim: true, default: "India" },
    state: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },

   cartAdds: {
  type: [
    {
      productCode: { type: String, trim: true, required: true },
      lastAddedAt: { type: Date, default: Date.now },
    },
  ],
  default: [],
},



    cart: {
      activeCartId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Cart",
        default: null,
        index: true,
      },

      activeCartType: {
        type: String,
        enum: ["cart", "abandoned"],
        default: "cart",
      },

      cartCount: { type: Number, default: 0 },
      abandonedCartCount: { type: Number, default: 0 },

      lastCartActivityAt: { type: Date, default: null, index: true },

      lastAbandonedCartId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AbandonedCart",
        default: null,
      },
    },

    // 🧩 Referral
    referralCode: { type: String, trim: true, default: "" },

    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },

    // ❤️ Preferences
    preferences: {
      categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
      favoriteBrands: [{ type: String, trim: true }],
      budgetRange: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
    },

    // 📊 Analytics
    analytics: {
      totalOrders: { type: Number, default: 0 },
      totalSpend: { type: Number, default: 0 },
      avgOrderValue: { type: Number, default: 0 },
      wishlistCount: { type: Number, default: 0 },
      couponUses: { type: Number, default: 0 },
      creditsEarned: { type: Number, default: 0 },
    },

    // 🚀 Status
    isActive: { type: Boolean, default: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

/**
 * ✅ Auto-generate customerId like 0001, 0002...
 */
customerSchema.pre("save", async function (next) {
  try {
    if (this.isNew && !this.customerId) {
      const counter = await Counter.findOneAndUpdate(
        { name: "customerId" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );

      this.customerId = String(counter.seq).padStart(4, "0");
    }

    // ✅ Auto set ageGroup if DOB exists
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
  } catch (err) {
    next(err);
  }
});

/**
 * ✅ INDEX FIX FOR GUEST CHECKOUT
 * Unique firebaseUID ONLY if it exists
 */
customerSchema.index(
  { firebaseUID: 1 },
  {
    unique: true,
    partialFilterExpression: { firebaseUID: { $type: "string" } },
  }
);

/**
 * ✅ Other Indexes
 */
customerSchema.index({ customerId: 1 });
customerSchema.index({ email: 1 });
customerSchema.index({ ageGroup: 1 });
customerSchema.index({ country: 1 });
customerSchema.index({ "cartAdds.productCode": 1 });

export default mongoose.models.Customer ||
  mongoose.model("Customer", customerSchema);
