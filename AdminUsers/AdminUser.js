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
      lowercase: true,
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
        validator(v) {
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: "Invalid email format",
      },
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },

    role: {
      type: String,
      enum: [
        "superadmin",
        "admin",
        "staff",
        "influencer",
        "viewer",
        "customer_care",
      ],
      default: "admin",
      index: true,
      lowercase: true,
      trim: true,
    },

    fullName: {
      type: String,
      trim: true,
      default: "",
    },

    profileImage: {
      type: String,
      default: "",
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

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

    // ✅ Used to invalidate all old JWT sessions
    sessionVersion: {
      type: Number,
      default: 0,
      index: true,
    },

    // ✅ Helpful for admin audit/debug
    forceLoggedOutAt: {
      type: Date,
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  { timestamps: true }
);

adminUserSchema.pre("save", async function (next) {
  try {
    if (!this.isModified("password")) return next();

    if (
      this.password?.startsWith("$2a$") ||
      this.password?.startsWith("$2b$") ||
      this.password?.startsWith("$2y$")
    ) {
      return next();
    }

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);

    next();
  } catch (err) {
    next(err);
  }
});

adminUserSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

adminUserSchema.methods.incrementLoginAttempts = async function () {
  const lockTime = 2 * 60 * 60 * 1000;

  if (this.lockUntil && this.lockUntil > Date.now()) {
    this.loginAttempts += 1;
  } else {
    this.loginAttempts = (this.loginAttempts || 0) + 1;

    if (this.loginAttempts >= 5) {
      this.lockUntil = new Date(Date.now() + lockTime);
    }
  }

  await this.save();
};

adminUserSchema.methods.resetLoginAttempts = async function () {
  this.loginAttempts = 0;
  this.lockUntil = null;
  await this.save();
};

adminUserSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};

// ✅ Force logout from all active sessions
adminUserSchema.methods.forceLogout = async function () {
  this.sessionVersion = (this.sessionVersion || 0) + 1;
  this.forceLoggedOutAt = new Date();
  await this.save();
};

if (mongoose.models.AdminUser) {
  delete mongoose.models.AdminUser;
}

const AdminUser = mongoose.model("AdminUser", adminUserSchema);

export default AdminUser;