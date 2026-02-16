import mongoose from "mongoose";
import crypto from "crypto";
import Counter from "../models/Counter.js";
import Coupon from "../Coupon/Coupon.js";

/**
 * ORDER ITEM SCHEMA
 * Snapshot of product/variant at purchase time (best practice)
 */
const orderItemSchema = new mongoose.Schema(
  {
    // ✅ stable id for RMA linking (no index-based bugs)
    lineId: { type: String, required: true, index: true },

    // ✅ support multiple product collections (Product / Footwear)
    productModel: {
      type: String,
      enum: ["Product", "Footwear"],
      default: "Product",
      required: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "productModel", // ✅ FIXED (was items.productModel)
    },

    // ✅ production / fulfillment tracking per line
    fulfillment: {
      allocatedQty: { type: Number, default: 0, min: 0 }, // reservedStock locked
      shippedQty: { type: Number, default: 0, min: 0 },   // shipped till now
      toProduceQty: { type: Number, default: 0, min: 0 }, // remaining
    },

    // ✅ purchase-time snapshot
    productSnapshot: {
      productCode: { type: String, default: "" },
      title: { type: String, required: true },
      slug: { type: String, default: "" },

      thumbnail: { type: String, default: "" },
      images: { type: [String], default: [] }, // ✅ FIXED

      productType: {
        type: String,
        enum: ["simple", "variable", "digital", "external"],
        default: "simple",
      },

      sku: { type: String, default: "" },
      tags: { type: [String], default: [] }, // ✅ FIXED

      hsnCode: { type: String, default: "" }, // ✅ keep
      weight: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
    },

    // ✅ chosen variant snapshot (if variable)
    variant: {
      variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
      sku: { type: String, default: "" },
      attributes: [{ key: String, value: String }],
      weight: { type: Number, default: 0 },
    },

    // ✅ easy access for frontend
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
  identity: { type: String, default: "" }, // ✅ email/phone identity store
},
orderType: { type: String, enum: ["parent", "shipment"], default: "shipment", index: true },
parentOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null, index: true },
splitSuffix: { type: String, default: "", index: true }, // "A","B"


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
  enum: ["cod", "razorpay", "exchange"],
  default: "cod",
  index: true,
},


    // ✅ FIX: added refund_pending to prevent crashes
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded",  "refund_pending","not_applicable",],
      default: "pending",
      index: true,
    },
// ✅ order confirmation (separate from fulfillment)

fulfillmentStatus: {
  type: String,
  enum: [
    "processing",
    "packed",

    // forward delivery
    "picked",
    "shipped",
    "out_for_delivery",
    "delivered",

    // ✅ NEW: reverse pickup (return/exchange)
    "pickup_initiated",

    "return_requested",
    "exchange_requested",
    "returned",
    "refunded",

    "cancelled",
    "rto",
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

  // ✅ XpressBees (added; does not affect Shiprocket)
  xpressbees: {
    shipmentId: { type: String, default: "", index: true }, // ✅ index true
    awb: { type: String, default: "", index: true },        // ✅ index true
    labelUrl: { type: String, default: "" },
    courierName: { type: String, default: "XpressBees" },
    trackingUrl: { type: String, default: "" },

lastWebhook: { type: mongoose.Schema.Types.Mixed, default: null },
lastTrack: { type: mongoose.Schema.Types.Mixed, default: null },
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
        trackingUrl: { type: String, default: "" },  // ✅ ADD THIS
      shippedAt: Date,
      deliveredAt: Date,
      expectedDelivery: Date,
    },

    customerMessage: { type: String, default: "" },
    adminRemarks: { type: String, default: "" },
customerSupportRemark: {
  type: String,
  default: "",
},
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

    priority: {
  type: String,
  enum: ["normal", "medium", "high"],
  default: "normal",
  index: true,
},

    isGiftOrder: { type: Boolean, default: false },
// ✅ order confirmation (separate from fulfillment)
isConfirmed: { type: Boolean, default: false, index: true },
confirmedAt: { type: Date, default: null },
confirmedBy: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "Admin",
  default: null,
},

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
      onlinePaymentDiscountApplied: { type: Boolean, default: false },
onlinePaymentDiscountPct: { type: Number, default: 0 },
onlinePaymentDiscountAmount: { type: Number, default: 0 },
couponIdentity: { type: String, default: "" },

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
// ✅ AUTO-HANDLE EXCHANGE PAYMENT LOGIC
// ========================================================================================
orderSchema.pre("validate", function (next) {
  try {
    if (this.paymentMethod === "exchange") {
      // no money movement
      this.paymentStatus = "not_applicable";

      // ensure accounting safety
      this.subtotal = Number(this.subtotal || 0);
      this.discount = 0;
      this.shippingFee = 0;
      this.tax = 0;

      this.totalAmount = this.subtotal;
      this.finalPayable = 0;

      // exchange orders are always confirmed logically
      if (!this.isConfirmed) {
        this.isConfirmed = true;
        this.confirmedAt = new Date();
      }
    }

    next();
  } catch (e) {
    next(e);
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

const hasChildren = async (orderId) => {
  const exists = await mongoose.model("Order").exists({ parentOrderId: orderId });
  return Boolean(exists);
};

// ========================================================================================
// ✅ AUTO-CONFIRM if Razorpay payment is paid
// ========================================================================================
orderSchema.pre("validate", function (next) {
  try {
    const isRazorpayPaid =
      this.paymentMethod === "razorpay" &&
      this.paymentStatus === "paid";

    if (isRazorpayPaid && !this.isConfirmed) {
      this.isConfirmed = true;
      this.confirmedAt = new Date();
    }

    next();
  } catch (e) {
    next(e);
  }
});

// ========================================================================================
// ✅ AUTO-SET PRIORITY: if paid -> default priority = medium
// - doesn't override if already "high"
// - only applies when priority is empty/normal
// ========================================================================================
orderSchema.pre("validate", function (next) {
  try {
    const isPaid = String(this.paymentStatus || "").toLowerCase() === "paid";

    if (isPaid) {
      const current = String(this.priority || "normal").toLowerCase();

      // don't touch high (manual urgent)
      if (current !== "high") {
        // set medium only when it's missing/normal
        if (!this.priority || current === "normal") {
          this.priority = "medium";
        }
      }
    }

    next();
  } catch (e) {
    next(e);
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

// ========================================================================================
// ✅ PATCH 3: Manual confirm helper (for COD/Admin confirmation)
// ========================================================================================
orderSchema.statics.confirmOrder = async function (orderId, adminId = null) {
  const update = {
    isConfirmed: true,
    confirmedAt: new Date(),
  };

  if (adminId) update.confirmedBy = adminId;

return this.findByIdAndUpdate(orderId, update, { new: true, runValidators: true });
};

// ========================================================================================
// ✅ PATCH 4: Safety guard — prevent shipping stages unless confirmed
// ✅ PLUS: Parent order can't be shipped (only shipment split orders can)
// ========================================================================================
orderSchema.pre("validate", async function (next) {
  try {
    const shippingStages = ["packed", "picked", "shipped", "out_for_delivery", "delivered"];

    // 1) Nothing can move to shipping unless confirmed
    if (!this.isConfirmed && shippingStages.includes(this.fulfillmentStatus)) {
      return next(new Error("Order must be confirmed before shipping stages"));
    }

    if (!this.isConfirmed && this.shipment?.status && shippingStages.includes(this.shipment.status)) {
      return next(new Error("Order must be confirmed before shipment status moves"));
    }

    // ✅ 2) Parent can be blocked ONLY if it actually has children
    const isMarkedParent = String(this.orderType || "").toLowerCase() === "parent";
    let actuallySplitParent = false;

    if (isMarkedParent && this._id) {
      const OrderModel = mongoose.model("Order");
      const childExists = await OrderModel.exists({ parentOrderId: this._id });
      actuallySplitParent = Boolean(childExists);
    }

    if (actuallySplitParent && shippingStages.includes(this.fulfillmentStatus)) {
      return next(new Error("Split parent order cannot be shipped. Ship child orders (-A/-B) only."));
    }

    if (
      actuallySplitParent &&
      this.shipment?.status &&
      shippingStages.includes(this.shipment.status)
    ) {
      return next(new Error("Split parent order shipment status cannot move. Ship only child orders."));
    }

    next();
  } catch (e) {
    next(e);
  }
});

// ========================================================================================
// ✅ AUTO-SET deliveredAt when status becomes delivered
// ========================================================================================
orderSchema.pre("validate", function (next) {
  try {
    const isDelivered =
      this.fulfillmentStatus === "delivered" ||
      this.shipment?.status === "delivered";

    if (isDelivered) {
      if (!this.shipment.deliveredAt) {
        this.shipment.deliveredAt = new Date();
      }

      if (!this.trackingDetails.deliveredAt) {
        this.trackingDetails.deliveredAt = new Date();
      }
    }

    next();
  } catch (e) {
    next(e);
  }
});







// Indexes
orderSchema.index({ "trackingDetails.trackingId": 1 });
orderSchema.index({ "items.lineId": 1 });
// ========================================================================================
// ✅ PATCH 5: Helpful indexes for confirmation workflows
// ========================================================================================
orderSchema.index({ isConfirmed: 1, orderDate: -1 });
orderSchema.index({ isConfirmed: 1, paymentStatus: 1 });
orderSchema.index({ isConfirmed: 1, fulfillmentStatus: 1 });
orderSchema.index({ "shipment.xpressbees.awb": 1 });
orderSchema.index({ "shipment.xpressbees.shipmentId": 1 });
orderSchema.index({ orderType: 1, parentOrderId: 1 });
orderSchema.index({ parentOrderId: 1, splitSuffix: 1 });
// Helpful indexes for RMA queries
orderSchema.index({ "rmas.rmaNumber": 1 });
orderSchema.index({ "rmas.status": 1 });
orderSchema.index({ "rmas.items.orderLineId": 1 });
orderSchema.index({ "rmas.fee.status": 1 });
orderSchema.index({ "rmas.reverseShipment.awb": 1 });
orderSchema.index({ "rmas.reverseShipment.shipmentId": 1 });

export default mongoose.models.Order || mongoose.model("Order", orderSchema);
