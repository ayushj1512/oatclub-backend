// models/ComingSoonModel.js
import mongoose from "mongoose";
import Counter from "../models/Counter.js";

/* ---------------- helpers ---------------- */
const normEmail = (v) => String(v || "").trim().toLowerCase();
const normPhone = (v) => String(v || "").trim().replace(/[^\d+]/g, "");

/* ---------------- notify/waitlist ---------------- */
const notifySchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null, index: true },
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },

    channel: { type: String, enum: ["email", "sms", "whatsapp", "any"], default: "any", index: true },
    source: { type: String, trim: true, default: "" },

    status: { type: String, enum: ["subscribed", "notified", "unsubscribed"], default: "subscribed", index: true },
    notifiedAt: { type: Date, default: null },
    unsubscribedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/* ---------------- events (light) ---------------- */
const eventSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["view", "notify_click", "notify_submit", "share"], required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null, index: true },
    sessionId: { type: String, trim: true, default: "" },
    source: { type: String, trim: true, default: "" },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { _id: true, timestamps: false }
);

/* ---------------- main schema ---------------- */
const comingSoonSchema = new mongoose.Schema(
  {
    // ✅ sequential code like 00001
    comingSoonCode: { type: String, unique: true, index: true, required: true },

    // ✅ link to Product
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, unique: true, index: true },

    // optional snapshot for fast listing
    snapshot: {
      title: { type: String, default: "" },
      slug: { type: String, default: "" },
      thumbnail: { type: String, default: "" },
      price: { type: Number, default: 0 },
    },

    status: { type: String, enum: ["coming_soon", "launched", "archived"], default: "coming_soon", index: true },

    // ✅ launch logic based on engagement
    launchDecision: {
      mode: { type: String, enum: ["auto", "manual"], default: "auto" },
      thresholdScore: { type: Number, default: 100 },
      currentScore: { type: Number, default: 0, index: true },
      decided: { type: Boolean, default: false },
      decidedAt: { type: Date, default: null },
      notes: { type: String, default: "" },
    },

    // ✅ key metrics (NO cart, NO wishlist)
    metrics: {
      views: { type: Number, default: 0 },
      uniqueViewers: { type: Number, default: 0 },
      notifyClicks: { type: Number, default: 0 },
      notifySubmits: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
      waitlistCount: { type: Number, default: 0, index: true },
      lastEngagedAt: { type: Date, default: null, index: true },
    },

    // optional recent events (cap in controller)
    events: { type: [eventSchema], default: [] },

    // notify/waitlist
    notifyList: { type: [notifySchema], default: [] },

    // scoring weights
    scoring: {
      wView: { type: Number, default: 1 },
      wNotifyClick: { type: Number, default: 5 },
      wNotifySubmit: { type: Number, default: 20 },
      wShare: { type: Number, default: 8 },
    },

    isActive: { type: Boolean, default: true, index: true },
    publishAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

/* ---------------- hooks ---------------- */
comingSoonSchema.pre("validate", async function (next) {
  try {
    // normalize notify contacts
    if (Array.isArray(this.notifyList) && this.notifyList.length) {
      this.notifyList = this.notifyList.map((n) => ({
        ...n,
        email: normEmail(n.email),
        phone: normPhone(n.phone),
      }));
    }

    // auto comingSoonCode
    if (!this.comingSoonCode) {
      const c = await Counter.findOneAndUpdate(
        { name: "comingsoon" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      this.comingSoonCode = String(c.seq).padStart(5, "0");
    }

    next();
  } catch (e) {
    next(e);
  }
});

/* ---------------- indexes ---------------- */
comingSoonSchema.index({ productId: 1 }, { unique: true });
comingSoonSchema.index({ status: 1, isActive: 1 });
comingSoonSchema.index({ "metrics.waitlistCount": -1, "metrics.views": -1 });
comingSoonSchema.index({ comingSoonCode: 1 }, { unique: true });

export default mongoose.models.ComingSoon || mongoose.model("ComingSoon", comingSoonSchema);
