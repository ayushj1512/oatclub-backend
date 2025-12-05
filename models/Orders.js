import mongoose from "mongoose";
import Counter from "./Counter.js";

/**
 * ORDER ITEM SCHEMA
 * Snapshot of product/variant at purchase time (best practice)
 */
const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },

    // ✅ purchase-time snapshot (so order doesn't break if product changes later)
    productSnapshot: {
      productCode: { type: String, default: "" }, // ✅ NEW (00001 style from Product)
      title: { type: String, required: true },
      slug: { type: String, default: "" },

      thumbnail: { type: String, default: "" },
      images: [{ type: String, default: [] }],

      category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
      subcategory: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },

      productType: { type: String, enum: ["simple", "variable", "digital", "external"], default: "simple" },

      sku: { type: String, default: "" }, // for simple products
      tags: [{ type: String, default: [] }], // ✅ tags are strings now

      // optional extras
      weight: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
    },

    // ✅ chosen variant snapshot (if variable)
    variant: {
      variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
      sku: { type: String, default: "" }, // ✅ NEW: variant SKU moved here (cleaner)
      attributes: [{ key: String, value: String }],
      image: { type: String, default: "" },
      weight: { type: Number, default: 0 },
    },

    quantity: { type: Number, required: true, min: 1 },

    // ✅ locked at purchase time
    price: { type: Number, required: true },
    compareAtPrice: { type: Number, default: null },
    subtotal: { type: Number, required: true },
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
      index: true,
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
    items: { type: [orderItemSchema], required: true },

    // 🔹 PAYMENT TOTALS
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },

    coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", default: null },

    shippingFee: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },

    totalAmount: { type: Number, required: true }, // subtotal + tax + shippingFee
    finalPayable: { type: Number, required: true }, // totalAmount - discount

    currency: { type: String, default: "INR" },

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
      enum: ["processing", "packed", "shipped", "out_for_delivery", "delivered", "returned", "cancelled"],
      default: "processing",
      index: true,
    },

    // 🔹 TRACKING
    trackingDetails: {
      trackingId: { type: String, default: "" },
      courierName: { type: String, default: "" },
      shippedAt: Date,
      deliveredAt: Date,
      expectedDelivery: Date,
    },

    // 🔹 COMMUNICATION
    customerMessage: { type: String, default: "" },
    adminRemarks: { type: String, default: "" },

    // 🔹 LINK TO SUPPORT TICKET
    queryRef: { type: mongoose.Schema.Types.ObjectId, ref: "Query", default: null },

    // 🔹 ENTERPRISE ORDER NUMBER (SEQUENTIAL)
    orderNumber: { type: String, unique: true, required: true, index: true },

    orderDate: { type: Date, default: Date.now, index: true },

    // 🔹 HOW CUSTOMER PLACED ORDER
    source: { type: String, enum: ["website", "mobile_app", "social_media", "manual"], default: "website" },

    isGiftOrder: { type: Boolean, default: false },

    // 🔹 ANALYTICS
    analytics: {
      categoryBreakdown: [
        {
          categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
          totalSpend: { type: Number, default: 0 },
          quantity: { type: Number, default: 0 },
        },
      ],

      // ✅ FIX: tags are strings now (no Tag model)
      tagsUsed: [{ type: String, default: [] }],

      couponApplied: { type: Boolean, default: false },
      creditsUsed: { type: Boolean, default: false },

      averageItemPrice: { type: Number, default: 0 },
      totalItems: { type: Number, default: 0 },
      paymentSuccessRate: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// ========================================================================================
// ⭐ AUTO-GENERATE SEQUENTIAL ORDER NUMBER
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

// ========================================================================================
// ✅ AUTO-CALC TOTALS (keeps createOrder controller simpler/safer)
// ========================================================================================
orderSchema.pre("validate", function (next) {
  try {
    // ensure item subtotals
    if (Array.isArray(this.items)) {
      this.items = this.items.map((it) => {
        const qty = Math.max(1, Number(it.quantity || 1));
        const price = Number(it.price || 0);
        const subtotal = Number(it.subtotal ?? price * qty);
        return { ...it, quantity: qty, price, subtotal };
      });
    }

    const subtotal = (this.items || []).reduce((sum, it) => sum + Number(it.subtotal || 0), 0);
    const shippingFee = Number(this.shippingFee || 0);
    const tax = Number(this.tax || 0);
    const discount = Number(this.discount || 0);

    this.subtotal = subtotal;
    this.totalAmount = subtotal + shippingFee + tax;
    this.finalPayable = Math.max(0, this.totalAmount - discount);

    // analytics basics
    const totalItems = (this.items || []).reduce((sum, it) => sum + Number(it.quantity || 0), 0);
    this.analytics = this.analytics || {};
    this.analytics.totalItems = totalItems;
    this.analytics.averageItemPrice = totalItems ? subtotal / totalItems : 0;

    next();
  } catch (e) {
    next(e);
  }
});

// Indexes
orderSchema.index({ "trackingDetails.trackingId": 1 });

export default mongoose.models.Order || mongoose.model("Order", orderSchema);
