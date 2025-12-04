import mongoose from "mongoose";
import Counter from "./Counter.js";  // <- NEW for auto-sequence

/**
 * ORDER ITEM SCHEMA
 * Snapshot of product at the time of purchase (enterprise best-practice)
 */
const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    name: { type: String, required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },

    variant: {
      color: String,
      size: String,
      attributes: Object,
    },

    quantity: { type: Number, required: true, min: 1 },

    price: { type: Number, required: true },  // price at time of order
    subtotal: { type: Number, required: true },

    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tag" }],
  },
  { _id: false }
);

/**
 * MAIN ORDER SCHEMA
 */
const orderSchema = new mongoose.Schema(
  {
    // 🔹 CUSTOMER
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },

    // 🔹 ADDRESS SNAPSHOT
    shippingAddressSnapshot: {
      fullName: String,
      phone: String,
      email: String,
      line1: String,
      line2: String,
      city: String,
      state: String,
      country: String,
      pincode: String,
    },

    billingAddressSnapshot: {
      fullName: String,
      phone: String,
      email: String,
      line1: String,
      line2: String,
      city: String,
      state: String,
      country: String,
      pincode: String,
    },

    // 🔹 ORDER ITEMS SNAPSHOT
    items: {
      type: [orderItemSchema],
      required: true,
    },

    // 🔹 PAYMENT
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },

    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      default: null,
    },

    shippingFee: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },

    totalAmount: { type: Number, required: true }, // subtotal + tax + shipping
    finalPayable: { type: Number, required: true }, // total - discount

    paymentMethod: {
      type: String,
      enum: ["cod", "card", "upi", "wallet", "netbanking"],
      default: "cod",
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },

    // 🔹 ORDER STATUS
    fulfillmentStatus: {
      type: String,
      enum: [
        "processing",
        "packed",
        "shipped",
        "out_for_delivery",
        "delivered",
        "returned",
        "cancelled",
      ],
      default: "processing",
    },

    // 🔹 TRACKING
    trackingDetails: {
      trackingId: String,
      courierName: String,
      shippedAt: Date,
      deliveredAt: Date,
      expectedDelivery: Date,
    },

    // 🔹 COMMUNICATION
    customerMessage: String,
    adminRemarks: String,

    // 🔹 LINK TO SUPPORT TICKET
    queryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Query",
      default: null,
    },

    // 🔹 ENTERPRISE ORDER NUMBER (SEQUENTIAL)
    orderNumber: {
      type: String,
      unique: true,
      required: true,
    },

    orderDate: {
      type: Date,
      default: Date.now,
    },

    // 🔹 HOW CUSTOMER PLACED ORDER
    source: {
      type: String,
      enum: ["website", "mobile_app", "social_media", "manual"],
      default: "website",
    },

    isGiftOrder: {
      type: Boolean,
      default: false,
    },

    // 🔹 ANALYTICS (SUPER IMPORTANT)
    analytics: {
      categoryBreakdown: [
        {
          categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
          totalSpend: Number,
          quantity: Number,
        },
      ],

      tagsUsed: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tag" }],

      couponApplied: { type: Boolean, default: false },
      creditsUsed: { type: Boolean, default: false },

      // 👑 NEW: long-term insights
      averageItemPrice: Number,
      totalItems: Number,
      paymentSuccessRate: Number,
    },
  },
  { timestamps: true }
);

// ========================================================================================
// ⭐ AUTO-GENERATE SEQUENTIAL ORDER NUMBER (ENTERPRISE GRADE)
// ========================================================================================
orderSchema.pre("validate", async function (next) {
  if (this.orderNumber) return next();

  try {
    const counter = await Counter.findOneAndUpdate(
      { id: "order" },
      { $inc: { sequence: 1 } },
      { new: true, upsert: true }
    );

    const padded = String(counter.sequence).padStart(6, "0");

    this.orderNumber = `MIRAY-${padded}`;
    next();
  } catch (err) {
    next(err);
  }
});

// Indexes
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ customerId: 1 });
orderSchema.index({ "trackingDetails.trackingId": 1 });
orderSchema.index({ fulfillmentStatus: 1 });
orderSchema.index({ orderDate: -1 });

export default mongoose.model("Order", orderSchema);
