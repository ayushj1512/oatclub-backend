import mongoose from "mongoose";
import crypto from "crypto";
import Counter from "../models/Counter.js";

/**
 * ORDER ITEM SCHEMA
 * Snapshot of product/variant at purchase time (best practice)
 */
const orderItemSchema = new mongoose.Schema(
  {
    // ✅ stable id for RMA linking (no index-based bugs)
    lineId: { type: String, required: true, index: true },

    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    // ✅ purchase-time snapshot (so order doesn't break if product changes later)
    productSnapshot: {
      productCode: { type: String, default: "" }, // (00001 style from Product)
      title: { type: String, required: true },
      slug: { type: String, default: "" },

      thumbnail: { type: String, default: "" },
      images: [{ type: String, default: [] }],

      category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        default: null,
      },
      subcategory: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        default: null,
      },

      productType: {
        type: String,
        enum: ["simple", "variable", "digital", "external"],
        default: "simple",
      },

      sku: { type: String, default: "" }, // for simple products
      tags: [{ type: String, default: [] }], // ✅ tags are strings now

      // optional extras
      weight: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
    },

    // ✅ chosen variant snapshot (if variable)
    variant: {
      variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
      sku: { type: String, default: "" }, // variant SKU lives here
      attributes: [{ key: String, value: String }],
      image: { type: String, default: "" },
      weight: { type: Number, default: 0 },
    },
// ✅ easy access for frontend (no need to parse attributes array)
selectedSize: { type: String, default: "" },
selectedColor: { type: String, default: "" },
    quantity: { type: Number, required: true, min: 1 },

    // ✅ locked at purchase time
    price: { type: Number, required: true },
    compareAtPrice: { type: Number, default: null },
    subtotal: { type: Number, required: true },
  },
  { _id: false }
);

// ============================================================================
// RMA (Return/Exchange) — Embedded inside Order (no new order)
// ============================================================================

const rmaItemSchema = new mongoose.Schema(
  {
    // ✅ stable link to order item
    orderLineId: { type: String, required: true, index: true },

    // ✅ keep index optional for backward compatibility
    orderItemIndex: { type: Number, default: null },

    quantity: { type: Number, required: true, min: 1 },

    // convenience snapshot (optional but useful for admin)
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    productCode: { type: String, default: "" },
    title: { type: String, default: "" },
    variantSku: { type: String, default: "" },
  },
  { _id: false }
);

const rmaSchema = new mongoose.Schema(
  {
    rmaNumber: { type: String, index: true }, // generated in pre-validate hook

    type: { type: String, enum: ["return", "exchange"], default: "return" },

    status: {
      type: String,
      enum: [
        "requested",
        "approved",
        "rejected",
        "pickup_scheduled",
        "picked",
        "in_transit",
        "received",
        "qc_pass",
        "qc_fail",
        "refund_initiated",
        "refund_completed",
        "replacement_shipped",
        "closed",
      ],
      default: "requested",
      index: true,
    },

    items: { type: [rmaItemSchema], required: true },

    reason: {
      type: String,
      enum: [
        "wrong_size",
        "wrong_item",
        "damaged",
        "defective",
        "quality_issue",
        "changed_mind",
        "other",
      ],
      default: "other",
    },

    customerNote: { type: String, default: "" },
    adminNote: { type: String, default: "" },

    resolution: {
      type: String,
      enum: ["pending", "refund", "exchange", "store_credit", "reject"],
      default: "pending",
    },

    // ✅ NEW: Exchange details (this is what was missing!)
    exchangeRequest: {
      productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        default: null,
      },
      variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
      variantSku: { type: String, default: "" },
      attributes: [{ key: String, value: String }],
      note: { type: String, default: "" },
    },

    // ✅ Exchange fee policy support
    fee: {
      amount: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
      status: {
        type: String,
        enum: ["unpaid", "paid", "waived"],
        default: "waived",
      },
    },

    refund: {
      amount: { type: Number, default: 0 },
      mode: {
        type: String,
        enum: ["source", "upi", "bank", "manual"],
        default: "source",
      },
      status: {
        type: String,
        enum: ["not_started", "initiated", "completed", "failed"],
        default: "not_started",
      },
      referenceId: { type: String, default: "" },
    },

    // Shiprocket reverse pickup / tracking
    reverseShipment: {
      provider: { type: String, default: "shiprocket" },
      orderId: { type: String, default: "" },
      shipmentId: { type: String, default: "" },
      awb: { type: String, default: "" },
      courierName: { type: String, default: "" },
      trackingUrl: { type: String, default: "" },

      pickupScheduledAt: Date,
      pickedAt: Date,
      receivedAt: Date,
    },
  },
  { timestamps: true }
);

/**
 * MAIN ORDER SCHEMA
 */
const orderSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

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

    items: { type: [orderItemSchema], required: true },

    // ✅ RMA embedded
    rmas: { type: [rmaSchema], default: [] },

    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },

    coupon: {
      code: String,
      discount: Number,
      finalTotal: Number,
    },

    shippingFee: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },

    totalAmount: { type: Number, required: true },
    finalPayable: { type: Number, required: true },

    currency: { type: String, default: "INR" },

    razorpay: {
      orderId: { type: String, default: "" },
      paymentId: { type: String, default: "" },
      signature: { type: String, default: "" },
      amount: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
      paidAt: { type: Date, default: null },
    },

    paymentMethod: {
      type: String,
      enum: ["cod", "razorpay"],
      default: "cod",
    },

    // ✅ FIX: added refund_pending to prevent crashes
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded", "refund_pending"],
      default: "pending",
      index: true,
    },

    fulfillmentStatus: {
  type: String,
  enum: [
    "processing",         // order placed / confirmed
    "packed",             // packed
    "picked",             // courier picked
    "shipped",            // in transit
    "out_for_delivery",   // out for delivery
    "delivered",          // delivered ✅ (sets deliveredAt)
    "return_requested",   // customer raised RMA return
    "exchange_requested", // customer raised RMA exchange
    "returned",           // return completed
    "cancelled",          // cancelled
    "rto",                // delivery failed, returned to origin
  ],
  default: "processing",
  index: true,
},


    shipment: {
      provider: {
        type: String,
        enum: ["shiprocket", "manual", "xpressbees", "ekart"],
        default: "shiprocket",
      },

      shiprocket: {
        orderId: { type: String, default: "" },
        shipmentId: { type: String, default: "" },
        awb: { type: String, default: "", index: true },
        courierName: { type: String, default: "" },
        trackingUrl: { type: String, default: "" },
      },

      status: {
        type: String,
        enum: [
          "pending",
          "processing",
          "packed",
          "shipped",
          "out_for_delivery",
          "delivered",
          "rto",
          "cancelled",
        ],
        default: "pending",
        index: true,
      },

      shippedAt: Date,
      deliveredAt: Date,
    },

    trackingDetails: {
      trackingId: { type: String, default: "" },
      courierName: { type: String, default: "" },
      shippedAt: Date,
      deliveredAt: Date,
      expectedDelivery: Date,
    },

    customerMessage: { type: String, default: "" },
    adminRemarks: { type: String, default: "" },

    queryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Query",
      default: null,
    },

    orderNumber: { type: String, unique: true, required: true, index: true },
    orderDate: { type: Date, default: Date.now, index: true },

    source: {
      type: String,
      enum: ["website", "mobile_app", "social_media", "manual"],
      default: "website",
    },

    isGiftOrder: { type: Boolean, default: false },

    analytics: {
      categoryBreakdown: [
        {
          categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
          totalSpend: { type: Number, default: 0 },
          quantity: { type: Number, default: 0 },
        },
      ],

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
// ✅ AUTO-GENERATE lineId for items (stable linking)
// ========================================================================================
orderSchema.pre("validate", function (next) {
  try {
    if (Array.isArray(this.items)) {
      this.items = this.items.map((it) => {
        if (!it.lineId) it.lineId = crypto.randomUUID();
        return it;
      });
    }
    next();
  } catch (err) {
    next(err);
  }
});

// ========================================================================================
// ⭐ AUTO-GENERATE SEQUENTIAL ORDER NUMBER
// ========================================================================================
orderSchema.pre("validate", async function (next) {
  if (this.orderNumber) return next();

  try {
    const counter = await Counter.findOneAndUpdate(
  { name: "order" },
  { $inc: { seq: 1 } },
  { new: true, upsert: true }
);

const padded = String(counter.seq).padStart(6, "0");

    this.orderNumber = `MIRAY-${padded}`;
    next();
  } catch (err) {
    next(err);
  }
});

// ========================================================================================
// ⭐ AUTO-GENERATE RMA NUMBERS for any new RMA missing rmaNumber
// ========================================================================================
orderSchema.pre("validate", async function (next) {
  try {
    if (!Array.isArray(this.rmas) || this.rmas.length === 0) return next();

    const need = this.rmas.filter((r) => !r?.rmaNumber);
    if (need.length === 0) return next();

    for (let i = 0; i < this.rmas.length; i++) {
      if (this.rmas[i]?.rmaNumber) continue;

      const counter = await Counter.findOneAndUpdate(
  { name: "rma" },
  { $inc: { seq: 1 } },
  { new: true, upsert: true }
);

const padded = String(counter.seq).padStart(6, "0");

      this.rmas[i].rmaNumber = `RMA-${padded}`;

      // ✅ ensure fee defaults are sane
      if (!this.rmas[i].fee) {
        this.rmas[i].fee = { amount: 0, currency: "INR", status: "waived" };
      } else {
        if (this.rmas[i].fee.amount == null) this.rmas[i].fee.amount = 0;
        if (!this.rmas[i].fee.currency) this.rmas[i].fee.currency = "INR";
        if (!this.rmas[i].fee.status)
          this.rmas[i].fee.status =
            this.rmas[i].fee.amount > 0 ? "unpaid" : "waived";
      }
    }

    next();
  } catch (err) {
    next(err);
  }
});


// ✅ AUTO-FILL selectedSize / selectedColor from variant.attributes
orderSchema.pre("validate", function (next) {
  try {
    if (!Array.isArray(this.items)) return next();

    this.items = this.items.map((it) => {
      const attrs = Array.isArray(it?.variant?.attributes)
        ? it.variant.attributes
        : [];

      const size =
        attrs.find((a) => String(a?.key || "").toLowerCase() === "size")?.value ||
        attrs.find((a) => String(a?.key || "").toLowerCase() === "sizes")?.value ||
        "";

      const color =
        attrs.find((a) => String(a?.key || "").toLowerCase() === "color")?.value ||
        attrs.find((a) => String(a?.key || "").toLowerCase() === "colour")?.value ||
        "";

      // ✅ store flat (clean)
      if (!String(it.selectedSize || "").trim() && size)
  it.selectedSize = String(size);

if (!String(it.selectedColor || "").trim() && color)
  it.selectedColor = String(color);


      return it;
    });

    next();
  } catch (err) {
    next(err);
  }
});


// ========================================================================================
// ✅ AUTO-CALC TOTALS
// ========================================================================================
orderSchema.pre("validate", function (next) {
  try {
    if (Array.isArray(this.items)) {
      this.items = this.items.map((it) => {
        const qty = Math.max(1, Number(it.quantity || 1));
        const price = Number(it.price || 0);
        const subtotal = Number(it.subtotal ?? price * qty);
        return { ...it, quantity: qty, price, subtotal };
      });
    }

    const subtotal = (this.items || []).reduce(
      (sum, it) => sum + Number(it.subtotal || 0),
      0
    );
    const shippingFee = Number(this.shippingFee || 0);
    const tax = Number(this.tax || 0);
    const discount = Number(this.discount || 0);

    this.subtotal = subtotal;
    this.totalAmount = subtotal + shippingFee + tax;
    this.finalPayable = Math.max(0, this.totalAmount - discount);

    const totalItems = (this.items || []).reduce(
      (sum, it) => sum + Number(it.quantity || 0),
      0
    );

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
orderSchema.index({ "items.lineId": 1 });

// Helpful indexes for RMA queries
orderSchema.index({ "rmas.rmaNumber": 1 });
orderSchema.index({ "rmas.status": 1 });
orderSchema.index({ "rmas.items.orderLineId": 1 });
orderSchema.index({ "rmas.fee.status": 1 });
orderSchema.index({ "rmas.reverseShipment.awb": 1 });
orderSchema.index({ "rmas.reverseShipment.shipmentId": 1 });

export default mongoose.models.Order || mongoose.model("Order", orderSchema);
