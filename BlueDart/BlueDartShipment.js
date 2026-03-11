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

    carrierSlug: {
      type: String,
      default: "bluedart",
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

    awbNumber: {
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

    externalOrderId: {
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
        "pickup_pending",
        "picked",
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

    shippedAt: {
      type: Date,
      default: null,
    },

    pickedUpAt: {
      type: Date,
      default: null,
    },

    deliveredAt: {
      type: Date,
      default: null,
    },

    bookingRequestedAt: {
      type: Date,
      default: null,
    },

    lastSyncedAt: {
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
  },
  { timestamps: true }
);

bluedartShipmentSchema.index({ orderNumber: 1, shipmentType: 1 });
bluedartShipmentSchema.index({ awbNumber: 1, orderNumber: 1 });
bluedartShipmentSchema.index({ status: 1, createdAt: -1 });
bluedartShipmentSchema.index({ referenceNumber: 1, createdAt: -1 });
bluedartShipmentSchema.index({ shipmentIdExternal: 1 });

export default
  mongoose.models.BlueDartShipment ||
  mongoose.model("BlueDartShipment", bluedartShipmentSchema);