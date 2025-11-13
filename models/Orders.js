import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product ID is required"],
    },
    name: { type: String, required: true },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: false,
    },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true },
    subtotal: { type: Number, required: true },
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tag" }],
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    // 🔹 Basic References
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: [true, "Customer reference is required"],
    },

    shippingAddress: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Address",
      required: [true, "Shipping address is required"],
    },

    billingAddress: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Address",
      default: null,
    },

    // 🔹 Order Items
    items: {
      type: [orderItemSchema],
      required: [true, "At least one order item is required"],
    },

    // 🔹 Payment & Pricing
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      default: null,
    },
    creditUsed: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Credit",
      default: null,
    },
    shippingFee: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    finalPayable: { type: Number, required: true },

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

    // 🔹 Fulfillment / Delivery
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

    trackingDetails: {
      trackingId: { type: String, trim: true, default: "" },
      courierName: { type: String, trim: true, default: "" },
      shippedAt: { type: Date, default: null },
      deliveredAt: { type: Date, default: null },
      expectedDelivery: { type: Date, default: null },
    },

    // 🔹 Customer Communications
    notes: { type: String, trim: true, default: "" },
    customerMessage: { type: String, trim: true, default: "" },
    adminRemarks: { type: String, trim: true, default: "" },

    // 🔹 Reference to Queries (if created for issues)
    queryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Query",
      default: null,
    },

    // 🔹 Order Metadata
    orderNumber: {
      type: String,
      unique: true,
      required: [true, "Order number is required"],
    },

    orderDate: {
      type: Date,
      default: Date.now,
    },

    source: {
      type: String,
      enum: ["website", "mobile_app", "social_media", "manual"],
      default: "website",
    },

    isGiftOrder: {
      type: Boolean,
      default: false,
    },

    // 🔹 Analytics Fields
    analytics: {
      categoryBreakdown: [
        {
          categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
          totalSpend: { type: Number, default: 0 },
          quantity: { type: Number, default: 0 },
        },
      ],
      tags: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tag" }],
      couponApplied: { type: Boolean, default: false },
      creditsUsed: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

// 🔹 Auto-generate order number if not provided
orderSchema.pre("validate", async function (next) {
  if (!this.orderNumber) {
    const random = Math.floor(100000 + Math.random() * 900000);
    this.orderNumber = `ORD-${random}`;
  }
  next();
});

// 🔹 Indexes for fast lookups
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ customerId: 1 });
orderSchema.index({ "trackingDetails.trackingId": 1 });
orderSchema.index({ fulfillmentStatus: 1 });
orderSchema.index({ orderDate: -1 });

export default mongoose.model("Order", orderSchema);
