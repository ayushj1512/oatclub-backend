import mongoose from "mongoose";
import Counter from "../models/Counter.js";

const platformSchema = new mongoose.Schema(
  {
    url: { type: String, trim: true, default: "" },
    followers: { type: Number, default: 0, min: 0 },

    // optional metrics
    avgViews: { type: Number, default: 0, min: 0 },
    engagementRate: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const influencerSchema = new mongoose.Schema(
  {
    /* 🔥 UNIQUE NUMERIC CODE */
    code: {
      type: String,
      unique: true,
      index: true,
      trim: true,
    },

    /* BASIC DETAILS */
    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    mobile: {
      type: String,
      trim: true,
      default: "",
    },

    city: {
      type: String,
      trim: true,
      default: "",
    },

    state: {
      type: String,
      trim: true,
      default: "",
    },

    /* SOCIALS */
    socials: {
      instagram: { type: platformSchema, default: () => ({}) },
      facebook: { type: platformSchema, default: () => ({}) },
      snapchat: { type: platformSchema, default: () => ({}) },
      youtube: { type: platformSchema, default: () => ({}) },
      other: { type: platformSchema, default: () => ({}) },
    },

    totalReach: {
      type: Number,
      default: 0,
    },

    /* BUSINESS */
    collaborationType: {
      type: String,
      enum: ["barter", "paid", "affiliate", "gifting"],
      default: "barter",
    },

    status: {
      type: String,
      enum: ["new", "contacted", "interested", "active", "rejected", "inactive"],
      default: "new",
      index: true,
    },

    source: {
      type: String,
      trim: true,
      default: "",
    },

    niche: {
      type: String,
      trim: true,
      default: "",
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

const padCode = (num) => String(num).padStart(6, "0");

/* 🔥 AUTO CODE + TOTAL REACH */
influencerSchema.pre("save", async function (next) {
  try {
    const s = this.socials || {};

    this.totalReach =
      (s.instagram?.followers || 0) +
      (s.facebook?.followers || 0) +
      (s.snapchat?.followers || 0) +
      (s.youtube?.followers || 0) +
      (s.other?.followers || 0);

    if (this.isNew && !this.code) {
      const counter = await Counter.findOneAndUpdate(
        { name: "influencer_program" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );

      this.code = padCode(counter.seq); // ✅ 000001 format
    }

    next();
  } catch (err) {
    next(err);
  }
});

const InfluencerProgram =
  mongoose.models.InfluencerProgram ||
  mongoose.model("InfluencerProgram", influencerSchema);

export default InfluencerProgram;