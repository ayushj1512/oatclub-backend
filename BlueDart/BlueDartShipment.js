import mongoose from "mongoose";

const trackingEventSchema = new mongoose.Schema(
  {
    eventCode: { type: String, default: "" },
    eventName: { type: String, default: "" },
    eventDescription: { type: String, default: "" },
    eventLocation: { type: String, default: "" },
    eventTime: { type: Date, default: null },
    raw: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const addressSchema = new mongoose.Schema(
  {
    fullName: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    line1: { type: String, default: "" },
    line2: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    country: { type: String, default: "India" },
    pincode: { type: String, default: "" },
  },
  { _id: false }
);

const dimensionsSchema = new mongoose.Schema(
  {
    length: { type: Number, default: 0 },
    breadth: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
  },
  { _id: false }
);

const bluedartShipmentSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },

    shipmentType: {
      type: String,
      enum: ["forward", "manual", "reverse"],
      default: "forward",
      index: true,
    },

    // ✅ Partner is eShipz, carrier can be BlueDart
    partner: {
      type: String,
      enum: ["eshipz"],
      default: "eshipz",
      index: true,
    },

    provider: {
      type: String,
      enum: ["eshipz"],
      default: "eshipz",
      index: true,
    },

    carrierSlug: {
      type: String,
      default: "bluedart",
      trim: true,
      lowercase: true,
      index: true,
    },

    carrierName: {
      type: String,
      default: "BlueDart",
      trim: true,
      index: true,
    },

    vendorId: {
      type: String,
      default: "",
      trim: true,
    },

    serviceType: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    paymentMode: {
      type: String,
      enum: ["COD", "Prepaid"],
      default: "Prepaid",
      index: true,
    },

    codAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    declaredValue: {
      type: Number,
      default: 0,
      min: 0,
    },

    currency: {
      type: String,
      default: "INR",
      trim: true,
    },

    // ✅ Universal shipment ids
    awbNumber: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    awb: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    referenceNumber: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    shipmentIdExternal: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    shipmentId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    externalOrderId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    eshipzOrderId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        "draft",
        "order_pushed",
        "created",
        "booked",
        "pickup_pending",
        "pickup_scheduled",
        "picked",
        "shipped",
        "in_transit",
        "out_for_delivery",
        "delivered",
        "exception",
        "rto",
        "cancelled",
        "failed",
      ],
      default: "draft",
      index: true,
    },

    statusCode: {
      type: String,
      default: "",
      trim: true,
    },

    rawStatus: {
      type: String,
      default: "",
      trim: true,
    },

    weight: {
      type: Number,
      default: 0.5,
      min: 0,
    },

    dimensions: {
      type: dimensionsSchema,
      default: () => ({}),
    },

    pieces: {
      type: Number,
      default: 1,
      min: 1,
    },

    sender: {
      type: addressSchema,
      default: () => ({}),
    },

    recipient: {
      type: addressSchema,
      default: () => ({}),
    },

    trackingUrl: {
      type: String,
      default: "",
      trim: true,
    },

    labelUrl: {
      type: String,
      default: "",
      trim: true,
    },

    manifestUrl: {
      type: String,
      default: "",
      trim: true,
    },

    invoiceUrl: {
      type: String,
      default: "",
      trim: true,
    },

    latestTrackingRemark: {
      type: String,
      default: "",
    },

    latestTrackingLocation: {
      type: String,
      default: "",
    },

    trackingEvents: {
      type: [trackingEventSchema],
      default: [],
    },

    expectedDelivery: {
      type: Date,
      default: null,
    },

    bookingRequestedAt: {
      type: Date,
      default: null,
    },

    bookedAt: {
      type: Date,
      default: null,
    },

    pickupScheduledAt: {
      type: Date,
      default: null,
    },

    pickedUpAt: {
      type: Date,
      default: null,
    },

    shippedAt: {
      type: Date,
      default: null,
    },

    outForDeliveryAt: {
      type: Date,
      default: null,
    },

    deliveredAt: {
      type: Date,
      default: null,
    },

    rtoAt: {
      type: Date,
      default: null,
    },

    failedAt: {
      type: Date,
      default: null,
    },

    lastSyncedAt: {
      type: Date,
      default: null,
      index: true,
    },

    lastTrackAt: {
      type: Date,
      default: null,
      index: true,
    },

    lastWebhookAt: {
      type: Date,
      default: null,
      index: true,
    },

    syncPending: {
      type: Boolean,
      default: false,
      index: true,
    },

    syncError: {
      type: String,
      default: "",
    },

    isCancelled: {
      type: Boolean,
      default: false,
      index: true,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    notes: {
      type: String,
      default: "",
      trim: true,
    },

    externalMeta: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    rawCreateRequest: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    rawCreateResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    rawTrackingResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    rawWebhookPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

// ✅ Keep awb and awbNumber synced
bluedartShipmentSchema.pre("validate", function (next) {
  try {
    if (!this.awb && this.awbNumber) this.awb = this.awbNumber;
    if (!this.awbNumber && this.awb) this.awbNumber = this.awb;

    if (!this.shipmentId && this.shipmentIdExternal) {
      this.shipmentId = this.shipmentIdExternal;
    }

    if (!this.shipmentIdExternal && this.shipmentId) {
      this.shipmentIdExternal = this.shipmentId;
    }

    if (!this.provider) this.provider = "eshipz";
    if (!this.partner) this.partner = "eshipz";

    if (!this.carrierName) this.carrierName = "BlueDart";
    if (!this.carrierSlug) this.carrierSlug = "bluedart";

    next();
  } catch (error) {
    next(error);
  }
});

bluedartShipmentSchema.index({ orderNumber: 1, shipmentType: 1 });
bluedartShipmentSchema.index({ orderId: 1, createdAt: -1 });

bluedartShipmentSchema.index({ partner: 1, createdAt: -1 });
bluedartShipmentSchema.index({ provider: 1, createdAt: -1 });
bluedartShipmentSchema.index({ carrierSlug: 1, createdAt: -1 });
bluedartShipmentSchema.index({ carrierName: 1, createdAt: -1 });

bluedartShipmentSchema.index({ awbNumber: 1, orderNumber: 1 });
bluedartShipmentSchema.index({ awb: 1, orderNumber: 1 });

bluedartShipmentSchema.index({ status: 1, createdAt: -1 });
bluedartShipmentSchema.index({ paymentMode: 1, createdAt: -1 });
bluedartShipmentSchema.index({ serviceType: 1, createdAt: -1 });

bluedartShipmentSchema.index({ referenceNumber: 1, createdAt: -1 });
bluedartShipmentSchema.index({ shipmentIdExternal: 1 });
bluedartShipmentSchema.index({ shipmentId: 1 });
bluedartShipmentSchema.index({ externalOrderId: 1 });
bluedartShipmentSchema.index({ eshipzOrderId: 1 });

bluedartShipmentSchema.index({ syncPending: 1, lastSyncedAt: 1 });
bluedartShipmentSchema.index({ isCancelled: 1, createdAt: -1 });

export default
  mongoose.models.BlueDartShipment ||
  mongoose.model("BlueDartShipment", bluedartShipmentSchema);