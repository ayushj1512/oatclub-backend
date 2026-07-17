import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const vendorUserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      required: true,
    },

    username: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      required: true,
    },

    password: {
      type: String,
      required: true,
      select: false,
    },

    phone: {
      type: String,
      trim: true,
    },

    modules: {
      sampling: { type: Boolean, default: true },
      pattern: { type: Boolean, default: true },
      production: { type: Boolean, default: true },
      cuttingList: { type: Boolean, default: true },
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },
    assignedProducts: [
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    modules: {
      sampling: { type: Boolean, default: false },
      pattern: { type: Boolean, default: false },
      production: { type: Boolean, default: false },
      cuttingList: { type: Boolean, default: false },
    },

    assignedAt: {
      type: Date,
      default: Date.now,
    },
  },
],
  },
  { timestamps: true }
);

vendorUserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

vendorUserSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

const VendorUser =
  mongoose.models.VendorUser ||
  mongoose.model("VendorUser", vendorUserSchema);

export default VendorUser;