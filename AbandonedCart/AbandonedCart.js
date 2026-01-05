import mongoose from "mongoose";

const cartItemAttributeSchema = new mongoose.Schema(
  {
    attribute: { type: mongoose.Schema.Types.ObjectId, ref: "Attribute", default: null },
    key: { type: String, trim: true, default: "" },
    value: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const abandonedCartItemSchema = new mongoose.Schema(
  {
    // refs
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },

    // IMPORTANT: variantId refers to the _id of the embedded variant in Product.variants[]
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },

    // snapshots from your Product model
    productCode: { type: String, trim: true, default: "" }, // e.g. "00001"
    title: { type: String, trim: true, default: "" },
    slug: { type: String, trim: true, lowercase: true, default: "" },

    // SKU snapshots
    productSku: { type: String, trim: true, default: "" }, // simple product sku
    variantSku: { type: String, trim: true, default: "" }, // variant sku (if variable)

    // display
    thumbnail: { type: String, trim: true, default: "" },
    image: { type: String, trim: true, default: "" },

    // pricing snapshot
    unitPrice: { type: Number, default: 0 }, // selling price at time
    compareAtPrice: { type: Number, default: null }, // MRP-like

    currency: { type: String, trim: true, default: "INR" },

    // qty
    qty: { type: Number, default: 1, min: 1 },

    // attributes snapshot
    attributes: { type: [cartItemAttributeSchema], default: [] },

    // optional inventory snapshot
    stock: { type: Number, default: null },
    isInStock: { type: Boolean, default: null },
  },
  { _id: false }
);

const abandonedCartSchema = new mongoose.Schema(
  {
    // link to customer
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },

    // store both keys
    customerFirebaseUID: { type: String, trim: true, index: true, default: "" },
    customerEmail: { type: String, trim: true, lowercase: true, index: true, default: "" },
    customerPhone: { type: String, trim: true, index: true, default: "" },

    // cart identifiers
    cartId: { type: String, trim: true, index: true, default: "" },
    sessionId: { type: String, trim: true, index: true, default: "" },
    fingerprint: { type: String, trim: true, index: true, default: "" },

    // cart snapshot
    items: { type: [abandonedCartItemSchema], default: [] },

    pricing: {
      subtotal: { type: Number, default: 0 },
      discount: { type: Number, default: 0 },
      shipping: { type: Number, default: 0 },
      tax: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      currency: { type: String, trim: true, default: "INR" },
    },

    coupon: {
      code: { type: String, trim: true, default: "" },
      discount: { type: Number, default: 0 },
    },

    // attribution for retargeting
    utm: {
      source: { type: String, trim: true, default: "" },
      medium: { type: String, trim: true, default: "" },
      campaign: { type: String, trim: true, default: "" },
      term: { type: String, trim: true, default: "" },
      content: { type: String, trim: true, default: "" },
    },

    context: {
      lastPageUrl: { type: String, trim: true, default: "" },
      referrer: { type: String, trim: true, default: "" },
      device: { type: String, trim: true, default: "" }, // "mobile/desktop"
      userAgent: { type: String, trim: true, default: "" },
      ip: { type: String, trim: true, default: "" },
    },

    cartRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cart",
      default: null,
      index: true,
    },

    // ✅ lifecycle status
    status: {
      type: String,
      enum: [
        "active",
        "abandoned",
        "recovered",
        "expired",
        // ✅ allow uppercase too (frontend might send)
        "ACTIVE",
        "ABANDONED",
        "RECOVERED",
        "EXPIRED",
      ],
      default: "active",
      lowercase: true, // ✅ always store lowercase
      index: true,
    },

    // snapshot flag
    isSnapshot: {
      type: Boolean,
      default: true,
      immutable: true,
    },

    lastActivityAt: { type: Date, default: Date.now, index: true },
    abandonedAt: { type: Date, default: null, index: true },

    recoveredAt: { type: Date, default: null },
    recoveredOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },

    // retarget tracking
    lastRetargetedAt: { type: Date, default: null, index: true },
    retargetCount: { type: Number, default: 0 },

    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

// indexes for speed
abandonedCartSchema.index({ status: 1, lastActivityAt: -1 });
abandonedCartSchema.index({ status: 1, abandonedAt: -1 });
abandonedCartSchema.index({ customerEmail: 1, status: 1 });
abandonedCartSchema.index({ customerFirebaseUID: 1, status: 1 });
abandonedCartSchema.index({ sessionId: 1, status: 1 });
abandonedCartSchema.index({ cartId: 1, status: 1 });

// normalize identifiers
abandonedCartSchema.pre("save", function (next) {
  if (this.customerEmail) this.customerEmail = String(this.customerEmail).trim().toLowerCase();
  if (this.customerFirebaseUID) this.customerFirebaseUID = String(this.customerFirebaseUID).trim();
  if (this.cartId) this.cartId = String(this.cartId).trim();
  if (this.sessionId) this.sessionId = String(this.sessionId).trim();

  // ✅ normalize status in case frontend sends ABANDONED
  if (this.status) this.status = String(this.status).trim().toLowerCase();

  next();
});

export default mongoose.models.AbandonedCart ||
  mongoose.model("AbandonedCart", abandonedCartSchema);
