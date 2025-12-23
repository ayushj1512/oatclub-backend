import mongoose from "mongoose";

const newsletterSubscriptionSchema = new mongoose.Schema(
  {
    /* ---------------- CORE IDENTITY ---------------- */
    email: {
      type: String,
      required: [true, "Email is required for subscription"],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email address",
      ],
    },

    /* ---------------- SUBSCRIPTION STATE ---------------- */
    isActive: {
      type: Boolean,
      default: true, // true = subscribed
      index: true,
    },

    subscribedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    unsubscribedAt: {
      type: Date,
      default: null,
    },

    /* ---------------- VERIFICATION (OPTIONAL) ---------------- */
    isVerified: {
      type: Boolean,
      default: false,
      index: true,
    },

    verificationToken: {
      type: String,
      default: null,
    },

    verifiedAt: {
      type: Date,
      default: null,
    },

    /* ---------------- DELIVERY & RATE LIMITING ---------------- */
    lastSentAt: {
      type: Date,
      default: null,
      index: true,
    },

    bounceCount: {
      type: Number,
      default: 0,
    },

    complaintCount: {
      type: Number,
      default: 0,
    },

    /* ---------------- ANALYTICS ---------------- */
    analytics: {
      totalSent: {
        type: Number,
        default: 0,
      },
      totalOpened: {
        type: Number,
        default: 0,
      },
      totalClicked: {
        type: Number,
        default: 0,
      },
      lastOpenedAt: {
        type: Date,
        default: null,
      },
      lastClickedAt: {
        type: Date,
        default: null,
      },
    },

    /* ---------------- SEGMENTATION (FUTURE USE) ---------------- */
    source: {
      type: String,
      default: "modal", // modal | footer | checkout | admin | import
      index: true,
    },

    tags: {
      type: [String], // eg: ["women", "sale", "returning"]
      default: [],
      index: true,
    },

    /* ---------------- SOFT FLAGS ---------------- */
    isSuppressed: {
      type: Boolean,
      default: false, // true = temporarily blocked from sending
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

/* ---------------- COMPOUND INDEXES (SCALE) ---------------- */

// Fast sending queries
newsletterSubscriptionSchema.index({
  isActive: 1,
  isSuppressed: 1,
  lastSentAt: 1,
});

// Analytics filtering
newsletterSubscriptionSchema.index({
  "analytics.totalSent": 1,
});

// Safety: never allow duplicate active emails
newsletterSubscriptionSchema.index(
  { email: 1 },
  { unique: true }
);

export default mongoose.model(
  "NewsletterSubscription",
  newsletterSubscriptionSchema
);
