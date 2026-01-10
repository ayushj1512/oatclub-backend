import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import Counter from "../models/Counter.js";

/**
 * User schema/model
 * Collection: users
 */
const userSchema = new mongoose.Schema(
  {
    // ✅ sequential id (NOT Mongo _id)
    userId: { type: String, required: true, unique: true, index: true }, // e.g. U-000001

    // ✅ username
    username: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
      minlength: 3,
    },

    // ✅ password (hashed)
    password: { type: String, required: true, select: false, minlength: 4 },

    role: {
  type: String,
  enum: ["user", "admin", "superadmin", "customer_care"],
  default: "user",
  index: true,
},


    /* 🛒 CART METRICS */
    activeCartId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cart",
      default: null,
      index: true,
    },

    lastCartActivityAt: {
      type: Date,
      default: null,
      index: true,
    },

    cartCount: {
      type: Number,
      default: 0,
    },

    isActive: { type: Boolean, default: true, index: true },

    notes: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

userSchema.index({ createdAt: -1 });

/**
 * ✅ Generates next userId like U-000001
 * Supports BOTH counter formats:
 * 1) { id: "user", sequence: 1 }
 * 2) { name: "user", seq: 1 }
 */
userSchema.pre("validate", async function (next) {
  try {
    if (this.userId) return next();

    // ✅ Try old format (id/sequence)
    let doc = await Counter.findOneAndUpdate(
      { id: "user" },
      { $inc: { sequence: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    let seq = doc?.sequence;

    // ✅ fallback if schema is using name/seq instead
    if (seq == null) {
      doc = await Counter.findOneAndUpdate(
        { name: "user" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      seq = doc?.seq;
    }

    if (seq == null) throw new Error("Counter sequence not found for user");

    const padded = String(seq).padStart(6, "0");
    this.userId = `U-${padded}`;

    return next();
  } catch (err) {
    return next(err);
  }
});

/**
 * ✅ Hash password whenever it's created/changed
 */
userSchema.pre("save", async function (next) {
  try {
    if (!this.isModified("password")) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (err) {
    return next(err);
  }
});

/**
 * ✅ Compare password helper
 */
userSchema.methods.comparePassword = async function (plainPassword) {
  return bcrypt.compare(plainPassword, this.password);
};

export default mongoose.models.User || mongoose.model("User", userSchema);
