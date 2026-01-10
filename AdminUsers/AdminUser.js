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
      lowercase: true, // ✅ normalize
      index: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      validate: {
        validator: function (v) {
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: "Invalid email format",
      },
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false, // ✅ don't send password by default
    },

    role: {
      type: String,
      enum: [
        "superadmin",
        "admin",
        "staff",
        "influencer",
        "viewer",
        "customer_care", // ✅ added
      ],
      default: "admin",
      index: true,
      lowercase: true, // ✅ extra safety
      trim: true,
    },

    fullName: {
      type: String,
      trim: true,
      default: "",
    },

    profileImage: {
      type: String, // Cloudinary URL
      default: "",
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    // 🔹 Permissions for granular control (optional use)
    permissions: {
      type: [String],
      default: [],
    },

    lastLogin: {
      type: Date,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    loginAttempts: {
      type: Number,
      default: 0,
    },

    lockUntil: {
      type: Date,
      default: null,
    },

    // 🔹 For auditing purposes
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  { timestamps: true }
);

/* ============================================================
   🔐 Password Hash Middleware
   ✅ prevents hashing if password already hashed
============================================================ */
adminUserSchema.pre("save", async function (next) {
  try {
    if (!this.isModified("password")) return next();

    // ✅ If already hashed (starts with $2a/$2b), skip rehashing
    if (this.password?.startsWith("$2a$") || this.password?.startsWith("$2b$")) {
      return next();
    }

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);

    next();
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   🔍 Compare Password Method
============================================================ */
adminUserSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

/* ============================================================
   🔒 Lockout Mechanism (Brute force protection)
   - 5 wrong attempts -> lock for 2 hours
============================================================ */
adminUserSchema.methods.incrementLoginAttempts = async function () {
  const lockTime = 2 * 60 * 60 * 1000; // 2 hours

  // If currently locked
  if (this.lockUntil && this.lockUntil > Date.now()) {
    this.loginAttempts += 1;
  } else {
    // not locked OR lock expired
    this.loginAttempts = (this.loginAttempts || 0) + 1;

    if (this.loginAttempts >= 5) {
      this.lockUntil = new Date(Date.now() + lockTime);
    }
  }

  await this.save();
};

/* ============================================================
   ✅ Reset attempts on successful login
============================================================ */
adminUserSchema.methods.resetLoginAttempts = async function () {
  this.loginAttempts = 0;
  this.lockUntil = null;
  await this.save();
};

/* ============================================================
   ✅ Helper: check if locked
============================================================ */
adminUserSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};

/* ============================================================
   ✅ Fix for Next.js / Hot reload model caching issue
============================================================ */
if (mongoose.models.AdminUser) {
  delete mongoose.models.AdminUser;
}

const AdminUser = mongoose.model("AdminUser", adminUserSchema);
export default AdminUser;
