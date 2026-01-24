// MediaUser/MediaUser.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const activitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["login", "logout", "upload", "read", "delete", "register", "update"],
      required: true,
    },
    message: { type: String, default: "" },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const mediaUserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, unique: true, index: true },
    passwordHash: { type: String, required: true },

    role: {
      type: String,
      enum: ["admin", "editor", "viewer"],
      default: "viewer",
      index: true,
    },

    isActive: { type: Boolean, default: true },

    activity: { type: [activitySchema], default: [] },
  },
  { timestamps: true }
);

mediaUserSchema.methods.comparePassword = function (plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

mediaUserSchema.statics.hashPassword = async function (plainPassword) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainPassword, salt);
};

mediaUserSchema.methods.addActivity = async function ({ type, message = "", meta = {} }, max = 100) {
  this.activity.unshift({ type, message, meta, at: new Date() });
  if (this.activity.length > max) this.activity = this.activity.slice(0, max);
  return this.save();
};

export default mongoose.models.MediaUser || mongoose.model("MediaUser", mediaUserSchema);
