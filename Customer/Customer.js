import mongoose from "mongoose";
import Counter from "../models/Counter.js";

/**
 * ✅ Customer Schema
 */
const customerSchema = new mongoose.Schema(
  {
    // ✅ Customer ID like 0001, 0002...
    customerId: {
      type: String,
      unique: true,
      index: true,
    },

    /**
     * 🔐 Firebase UID — OPTIONAL (guest checkout allowed)
     * ✅ No default null (important!)
     */
    firebaseUID: {
      type: String,
      trim: true,
      index: true,
    },

    // 👤 Basic Profile
    name: { type: String, trim: true, default: "" },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      index: true,
    },

    phone: { type: String, trim: true, default: "", index: true },

    profileImage: { type: String, default: "" },

    // 🎂 Optional
    dateOfBirth: { type: Date, default: null },

    gender: {
      type: String,
      enum: ["male", "female", "non_binary", "prefer_not_to_say", "unknown"],
      default: "unknown",
    },

    ageGroup: {
      type: String,
      enum: ["Gen Alpha", "Gen Z", "Millennial", "Gen X", "Boomer", "Unknown"],
      default: "Unknown",
    },

    // 🌍 Location
    country: { type: String, trim: true, default: "India" },
    state: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },

    // ✅ Banking + UPI details for refunds / payouts
    payoutDetails: {
      bank: {
        accountHolderName: { type: String, trim: true, default: "" },
        accountNumber: { type: String, trim: true, default: "" },
        ifscCode: { type: String, trim: true, uppercase: true, default: "" },
      },
      upi: {
        upiId: { type: String, trim: true, lowercase: true, default: "" },
      },
      updatedAt: { type: Date, default: null },
    },

    cartAdds: {
      type: [
        new mongoose.Schema(
          {
            productId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "Product",
              default: null,
              index: true,
            },
            productCode: {
              type: String,
              trim: true,
              required: true,
              index: true,
            },
            variantId: {
              type: mongoose.Schema.Types.ObjectId,
              default: null,
              index: true,
            },
            size: { type: String, trim: true, default: "" },
            lastAddedAt: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    cart: {
      activeCartId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Cart",
        default: null,
        index: true,
      },

      activeCartType: {
        type: String,
        enum: ["cart", "abandoned"],
        default: "cart",
      },

      cartCount: { type: Number, default: 0 },
      abandonedCartCount: { type: Number, default: 0 },

      lastCartActivityAt: { type: Date, default: null, index: true },

      lastAbandonedCartId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AbandonedCart",
        default: null,
      },
    },

    // 🧩 Referral
    referralCode: { type: String, trim: true, default: "" },

    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },

    // ❤️ Preferences
    preferences: {
      categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
      favoriteBrands: [{ type: String, trim: true }],
      budgetRange: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
      },
    },

    // 📊 Analytics Snapshot
    analytics: {
      // order count/value
      totalOrders: { type: Number, default: 0 },
      totalSpend: { type: Number, default: 0 },
      avgOrderValue: { type: Number, default: 0 },

      highestOrderValue: { type: Number, default: 0 },
      lowestOrderValue: { type: Number, default: 0 },

      // fulfillment behavior
      processingOrders: { type: Number, default: 0 },
      packedOrders: { type: Number, default: 0 },
      pickedOrders: { type: Number, default: 0 },
      shippedOrders: { type: Number, default: 0 },
      outForDeliveryOrders: { type: Number, default: 0 },
      deliveredOrders: { type: Number, default: 0 },

      cancelledOrders: { type: Number, default: 0 },
      returnRequestedOrders: { type: Number, default: 0 },
      exchangeRequestedOrders: { type: Number, default: 0 },
      returnedOrders: { type: Number, default: 0 },
      refundedOrdersByFulfillment: { type: Number, default: 0 },
      exchangedOrders: { type: Number, default: 0 },
      rtoOrders: { type: Number, default: 0 },
      failedOrders: { type: Number, default: 0 },

      // payment behavior
      codOrders: { type: Number, default: 0 },
      prepaidOrders: { type: Number, default: 0 },
      exchangeOrders: { type: Number, default: 0 },

      paymentPendingOrders: { type: Number, default: 0 },
      paidOrders: { type: Number, default: 0 },
      paymentFailedOrders: { type: Number, default: 0 },
      refundPendingOrders: { type: Number, default: 0 },
      refundedOrders: { type: Number, default: 0 },

      // confirmation behavior
      confirmedOrders: { type: Number, default: 0 },
      unconfirmedOrders: { type: Number, default: 0 },
      confirmedByCustomerOrders: { type: Number, default: 0 },
      confirmedByAdminOrders: { type: Number, default: 0 },
      confirmedByAutoOrders: { type: Number, default: 0 },

      // dates
      firstOrderAt: { type: Date, default: null },
      lastOrderAt: { type: Date, default: null },
      lastDeliveredAt: { type: Date, default: null },
      lastCancelledAt: { type: Date, default: null },
      lastReturnedAt: { type: Date, default: null },
      lastRtoAt: { type: Date, default: null },

      // calculated rates
      deliveryRate: { type: Number, default: 0 },
      cancellationRate: { type: Number, default: 0 },
      returnRate: { type: Number, default: 0 },
      rtoRate: { type: Number, default: 0 },
      paymentSuccessRate: { type: Number, default: 0 },

      // customer segmentation
      customerType: {
        type: String,
        enum: ["new", "repeat", "vip", "risky", "inactive"],
        default: "new",
        index: true,
      },

      riskScore: { type: Number, default: 0 },

      // existing engagement fields
      wishlistCount: { type: Number, default: 0 },
      couponUses: { type: Number, default: 0 },
      creditsEarned: { type: Number, default: 0 },

      lastAnalyticsSyncAt: { type: Date, default: null },
    },

    // 🚀 Status
    isActive: { type: Boolean, default: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

/**
 * ✅ Auto-generate customerId like 0001, 0002...
 */
customerSchema.pre("save", async function (next) {
  try {
    if (this.isNew && !this.customerId) {
      const counter = await Counter.findOneAndUpdate(
        { name: "customerId" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );

      this.customerId = String(counter.seq).padStart(4, "0");
    }

    // ✅ mark payoutDetails.updatedAt when payout details are modified
    if (this.isModified("payoutDetails")) {
      this.payoutDetails = this.payoutDetails || {};
      this.payoutDetails.updatedAt = new Date();
    }

    // ✅ Auto set ageGroup if DOB exists
    if (this.dateOfBirth) {
      const age = Math.floor(
        (Date.now() - this.dateOfBirth.getTime()) /
          (365.25 * 24 * 60 * 60 * 1000)
      );

      if (age <= 13) this.ageGroup = "Gen Alpha";
      else if (age <= 27) this.ageGroup = "Gen Z";
      else if (age <= 42) this.ageGroup = "Millennial";
      else if (age <= 57) this.ageGroup = "Gen X";
      else if (age <= 75) this.ageGroup = "Boomer";
      else this.ageGroup = "Unknown";
    }

    next();
  } catch (err) {
    next(err);
  }
});

/**
 * ✅ INDEX FIX FOR GUEST CHECKOUT
 * Unique firebaseUID ONLY if it exists
 */
customerSchema.index(
  { firebaseUID: 1 },
  {
    unique: true,
    partialFilterExpression: { firebaseUID: { $type: "string" } },
  }
);

/**
 * ✅ Cart indexes
 */
customerSchema.index({ "cartAdds.productCode": 1, "cartAdds.size": 1 });
customerSchema.index({ "cartAdds.variantId": 1 });
customerSchema.index({ "cartAdds.productCode": 1 });

/**
 * ✅ Basic indexes
 */
customerSchema.index({ customerId: 1 });
customerSchema.index({ email: 1 });
customerSchema.index({ phone: 1 });
customerSchema.index({ ageGroup: 1 });
customerSchema.index({ country: 1 });
customerSchema.index({ state: 1 });
customerSchema.index({ city: 1 });
customerSchema.index({ isActive: 1 });
customerSchema.index({ joinedAt: -1 });
customerSchema.index({ createdAt: -1 });

/**
 * ✅ Analytics indexes
 */
customerSchema.index({ "analytics.totalOrders": -1 });
customerSchema.index({ "analytics.totalSpend": -1 });
customerSchema.index({ "analytics.avgOrderValue": -1 });
customerSchema.index({ "analytics.lastOrderAt": -1 });
customerSchema.index({ "analytics.firstOrderAt": -1 });

customerSchema.index({ "analytics.customerType": 1 });
customerSchema.index({ "analytics.riskScore": -1 });

customerSchema.index({ "analytics.deliveredOrders": -1 });
customerSchema.index({ "analytics.cancelledOrders": -1 });
customerSchema.index({ "analytics.returnedOrders": -1 });
customerSchema.index({ "analytics.rtoOrders": -1 });

customerSchema.index({ "analytics.deliveryRate": -1 });
customerSchema.index({ "analytics.cancellationRate": -1 });
customerSchema.index({ "analytics.returnRate": -1 });
customerSchema.index({ "analytics.rtoRate": -1 });
customerSchema.index({ "analytics.paymentSuccessRate": -1 });

customerSchema.index({ "analytics.codOrders": -1 });
customerSchema.index({ "analytics.prepaidOrders": -1 });
customerSchema.index({ "analytics.refundPendingOrders": -1 });

export default mongoose.models.Customer ||
  mongoose.model("Customer", customerSchema);