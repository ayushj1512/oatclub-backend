// models/AdminUser.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const adminUserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 50,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false, // don't send password by default
    },

    role: {
      type: String,
      enum: ["superadmin", "admin", "staff", "influencer", "viewer"],
      default: "admin",
    },

    fullName: {
      type: String,
      trim: true,
    },

    profileImage: {
      type: String, // Cloudinary URL
      default: "",
    },

    phone: {
      type: String,
      trim: true,
    },

    // 🔹 Permissions for granular control (optional use)
    permissions: {
      type: [String],
      default: [], // e.g. ["manageOrders", "manageCoupons", "viewAnalytics"]
    },

    lastLogin: {
      type: Date,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    loginAttempts: {
      type: Number,
      default: 0,
    },

    lockUntil: {
      type: Date,
    },

    // 🔹 For auditing purposes
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
    },
  },
  { timestamps: true }
);

// 🔐 Password Hash Middleware
adminUserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// 🔍 Compare Password Method
adminUserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// 🔒 Lockout Mechanism (Optional for brute force protection)
adminUserSchema.methods.incrementLoginAttempts = async function () {
  const lockTime = 2 * 60 * 60 * 1000; // 2 hours
  if (this.lockUntil && this.lockUntil > Date.now()) {
    this.loginAttempts += 1;
    if (this.loginAttempts >= 5) this.isActive = false;
  } else {
    this.loginAttempts = 1;
    this.lockUntil = Date.now() + lockTime;
  }
  await this.save();
};

export default mongoose.models.AdminUser || mongoose.model("AdminUser", adminUserSchema);
