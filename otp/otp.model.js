import mongoose from "mongoose";
import {
  OTP_CHANNELS,
  OTP_PURPOSES,
  OTP_STATUSES,
} from "./otp.constants.js";

const otpLogSchema = new mongoose.Schema(
  {
    referenceId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    identifier: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    maskedIdentifier: {
      type: String,
      default: "",
      trim: true,
    },

    channel: {
      type: String,
      enum: OTP_CHANNELS,
      default: "email",
      index: true,
    },

    purpose: {
      type: String,
      enum: OTP_PURPOSES,
      required: true,
      index: true,
    },

    otpHash: {
      type: String,
      required: true,
      select: false,
    },

    status: {
      type: String,
      enum: OTP_STATUSES,
      default: "pending",
      index: true,
    },

    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    resendCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    retentionExpiresAt: {
      type: Date,
      required: true,
    },

    sentAt: {
      type: Date,
      default: null,
      index: true,
    },

    verifiedAt: {
      type: Date,
      default: null,
      index: true,
    },

    lastAttemptAt: {
      type: Date,
      default: null,
    },

    invalidatedAt: {
      type: Date,
      default: null,
    },

    failedAt: {
      type: Date,
      default: null,
    },

    providerMessageId: {
      type: String,
      default: "",
      trim: true,
    },

    failureReason: {
      type: String,
      default: "",
      trim: true,
    },

    requestedIp: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    userAgent: {
      type: String,
      default: "",
      trim: true,
    },

    name: {
      type: String,
      default: "",
      trim: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/*
  expiresAt OTP validity ke liye hai.
  retentionExpiresAt log cleanup ke liye hai.
  Isse OTP expire hote hi logs delete nahi honge.
*/
otpLogSchema.index(
  { retentionExpiresAt: 1 },
  { expireAfterSeconds: 0 }
);

otpLogSchema.index({
  identifier: 1,
  purpose: 1,
  status: 1,
  createdAt: -1,
});

otpLogSchema.index({
  purpose: 1,
  status: 1,
  createdAt: -1,
});

otpLogSchema.index({
  requestedIp: 1,
  createdAt: -1,
});

otpLogSchema.index({
  createdAt: -1,
  status: 1,
});

const OtpLog =
  mongoose.models.OtpLog ||
  mongoose.model("OtpLog", otpLogSchema);

export default OtpLog;