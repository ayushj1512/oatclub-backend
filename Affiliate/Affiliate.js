import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import Counter from "../models/Counter.js";

const payoutAccountSchema = new mongoose.Schema(
  {
    method: {
      type: String,
      enum: ["upi", "bank", "manual"],
      default: "upi",
    },

    upiId: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    accountHolderName: {
      type: String,
      trim: true,
      default: "",
    },

    bankName: {
      type: String,
      trim: true,
      default: "",
    },

    accountNumber: {
      type: String,
      trim: true,
      default: "",
      select: false,
    },

    ifscCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
  },
  { _id: false }
);

const commissionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["percentage", "flat"],
      default: "percentage",
    },

    value: {
      type: Number,
      default: 10,
      min: 0,
    },

    calculationBase: {
      type: String,
      enum: ["final_payable", "subtotal"],
      default: "final_payable",
    },

    approvalTrigger: {
      type: String,
      enum: ["paid", "shipped", "delivered"],
      default: "delivered",
    },

    holdDays: {
      type: Number,
      default: 7,
      min: 0,
    },
  },
  { _id: false }
);

const affiliateSchema = new mongoose.Schema(
  {
    affiliateNumber: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      index: true,
    },

    phone: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    state: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    platform: {
      type: String,
      enum: [
        "instagram",
        "youtube",
        "facebook",
        "snapchat",
        "twitter",
        "linkedin",
        "website",
        "other",
      ],
      default: "instagram",
      index: true,
    },

    socialLinks: {
      instagram: { type: String, trim: true, default: "" },
      youtube: { type: String, trim: true, default: "" },
      facebook: { type: String, trim: true, default: "" },
      snapchat: { type: String, trim: true, default: "" },
      twitter: { type: String, trim: true, default: "" },
      linkedin: { type: String, trim: true, default: "" },
      website: { type: String, trim: true, default: "" },
    },

    coupon: {
      couponId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Coupon",
        default: null,
        index: true,
      },

      code: {
        type: String,
        uppercase: true,
        trim: true,
        default: "",
        index: true,
      },

      discountType: {
        type: String,
        enum: ["percentage", "flat"],
        default: "percentage",
      },

      discountValue: {
        type: Number,
        default: 10,
        min: 0,
      },

      minPurchase: {
        type: Number,
        default: 0,
        min: 0,
      },

      maxDiscount: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    commission: {
      type: commissionSchema,
      default: () => ({
        type: "percentage",
        value: 10,
        calculationBase: "final_payable",
        approvalTrigger: "delivered",
        holdDays: 7,
      }),
    },

    payoutAccount: {
      type: payoutAccountSchema,
      default: () => ({
        method: "upi",
      }),
    },

    stats: {
      totalOrders: {
        type: Number,
        default: 0,
        min: 0,
      },

      confirmedOrders: {
        type: Number,
        default: 0,
        min: 0,
      },

      deliveredOrders: {
        type: Number,
        default: 0,
        min: 0,
      },

      cancelledOrders: {
        type: Number,
        default: 0,
        min: 0,
      },

      returnedOrders: {
        type: Number,
        default: 0,
        min: 0,
      },

      totalRevenue: {
        type: Number,
        default: 0,
        min: 0,
      },

      pendingCommission: {
        type: Number,
        default: 0,
        min: 0,
      },

      approvedCommission: {
        type: Number,
        default: 0,
        min: 0,
      },

      paidCommission: {
        type: Number,
        default: 0,
        min: 0,
      },

      lastOrderAt: {
        type: Date,
        default: null,
      },

      lastEvaluatedAt: {
        type: Date,
        default: null,
      },
    },

    payoutSummary: {
      lifetimePayable: {
        type: Number,
        default: 0,
        min: 0,
      },

      totalPaid: {
        type: Number,
        default: 0,
        min: 0,
      },

      pendingPayout: {
        type: Number,
        default: 0,
        min: 0,
      },

      lastPaidAt: {
        type: Date,
        default: null,
      },

      lastPaymentReference: {
        type: String,
        trim: true,
        default: "",
      },
    },

    status: {
      type: String,
      enum: ["pending", "active", "paused", "blocked"],
      default: "active",
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

/* ---------------------------------------------------------------
   NORMALIZATION
---------------------------------------------------------------- */

affiliateSchema.pre("validate", async function (next) {
  try {
    if (!this.affiliateNumber) {
      const counter = await Counter.findOneAndUpdate(
        { name: "affiliate" },
        { $inc: { seq: 1 } },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
        }
      );

      this.affiliateNumber = `AFF-${String(counter.seq).padStart(4, "0")}`;
    }

    if (this.username) {
      this.username = String(this.username).trim().toLowerCase();
    }

    if (this.email) {
      this.email = String(this.email).trim().toLowerCase();
    }

    if (this.coupon?.code) {
      this.coupon.code = String(this.coupon.code).trim().toUpperCase();
    }

    next();
  } catch (error) {
    next(error);
  }
});

/* ---------------------------------------------------------------
   PASSWORD HASHING
---------------------------------------------------------------- */

affiliateSchema.pre("save", async function (next) {
  try {
    if (!this.isModified("password")) return next();

    this.password = await bcrypt.hash(this.password, 12);
    next();
  } catch (error) {
    next(error);
  }
});

affiliateSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

/* ---------------------------------------------------------------
   SAFE RESPONSE
---------------------------------------------------------------- */

affiliateSchema.methods.toSafeObject = function () {
  const object = this.toObject();

  delete object.password;

  if (object.payoutAccount) {
    delete object.payoutAccount.accountNumber;
  }

  return object;
};

/* ---------------------------------------------------------------
   INDEXES
---------------------------------------------------------------- */

affiliateSchema.index({ createdAt: -1 });
affiliateSchema.index({ status: 1, createdAt: -1 });
affiliateSchema.index({ isActive: 1, createdAt: -1 });
affiliateSchema.index({ isDeleted: 1, createdAt: -1 });
affiliateSchema.index({ platform: 1, createdAt: -1 });
affiliateSchema.index({ "coupon.code": 1, isActive: 1 });
affiliateSchema.index({ "coupon.couponId": 1 });
affiliateSchema.index({ "stats.totalRevenue": -1 });
affiliateSchema.index({ "stats.approvedCommission": -1 });

export default mongoose.models.Affiliate ||
  mongoose.model("Affiliate", affiliateSchema);