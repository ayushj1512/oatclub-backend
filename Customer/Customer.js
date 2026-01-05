import mongoose from "mongoose";
import Counter from "../models/Counter.js"; // ✅ Import from models/Counter.js

/**
 * ✅ Customer Schema
 */
const customerSchema = new mongoose.Schema(
  {
    // ✅ New: Customer ID like 0001, 0002...
    customerId: {
      type: String,
      unique: true,
      index: true,
    },

    // 🔐 Firebase UID — now OPTIONAL for guest checkout
    firebaseUID: {
      type: String,
      required: false,
      unique: true,
      sparse: true, // ✅ Allows multiple docs without firebaseUID
      trim: true,
      default: null,
    },

    // 👤 Basic Profile — optional for OAuth/Guest
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

    // 🎂 Optional data
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

    // 🌍 Location fields
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

      cartCount: {
        type: Number,
        default: 0,
      },

      abandonedCartCount: {
        type: Number,
        default: 0,
      },

      lastCartActivityAt: {
        type: Date,
        default: null,
        index: true,
      },

      lastAbandonedCartId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AbandonedCart",
        default: null,
      },
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

/**
 * ✅ Auto-generate customerId like 0001, 0002...
 */
customerSchema.pre("save", async function (next) {
  try {
    // ✅ Assign customerId only when creating new customer
    if (this.isNew && !this.customerId) {
      const counter = await Counter.findOneAndUpdate(
        { name: "customerId" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );

      this.customerId = String(counter.seq).padStart(4, "0");
    }

    // ✅ Automatically set age group when DOB exists
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
 * ✅ Indexes for fast querying
 */
customerSchema.index({ customerId: 1 });
customerSchema.index({ firebaseUID: 1 });
customerSchema.index({ email: 1 });
customerSchema.index({ ageGroup: 1 });
customerSchema.index({ country: 1 });

export default mongoose.models.Customer ||
  mongoose.model("Customer", customerSchema);
