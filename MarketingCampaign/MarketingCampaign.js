import mongoose from "mongoose";

const { Schema } = mongoose;

const clickSchema = new Schema(
  {
    clickedAt: {
      type: Date,
      default: Date.now,
    },

    ip: String,
    userAgent: String,
    referrer: String,
    device: String,
  },
  { _id: false }
);

const journeyEventSchema = new Schema(
  {
    event: {
      type: String,
      enum: [
        "landing",
        "collection_view",
        "product_view",
        "add_to_cart",
        "checkout_started",
        "order_created",
      ],
      required: true,
    },

    pageUrl: String,

    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
    },

    productName: String,

    cartValue: {
      type: Number,
      default: 0,
    },

    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
    },

    orderNumber: String,

    revenue: {
      type: Number,
      default: 0,
    },

    occurredAt: {
      type: Date,
      default: Date.now,
    },

    ip: String,
    userAgent: String,
  },
  { _id: false }
);

const marketingLinkSchema = new Schema(
  {
    shortCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    destinationUrl: {
      type: String,
      required: true,
    },

    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
    },

    phone: String,
    name: String,

    sentAt: Date,

    clickCount: {
      type: Number,
      default: 0,
    },

    uniqueClickCount: {
      type: Number,
      default: 0,
    },

    firstClickedAt: Date,
    lastClickedAt: Date,

    converted: {
      type: Boolean,
      default: false,
    },

    convertedAt: Date,

    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
    },

    orderNumber: String,

    revenue: {
      type: Number,
      default: 0,
    },

    clicks: [clickSchema],

    journey: [journeyEventSchema],
  },
  { timestamps: true }
);

const marketingCampaignSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },

    description: String,

    status: {
      type: String,
      enum: ["draft", "active", "paused", "completed"],
      default: "draft",
    },

    totalLinks: {
      type: Number,
      default: 0,
    },

    totalClicks: {
      type: Number,
      default: 0,
    },

    uniqueClicks: {
      type: Number,
      default: 0,
    },

    totalOrders: {
      type: Number,
      default: 0,
    },

    totalRevenue: {
      type: Number,
      default: 0,
    },

    links: [marketingLinkSchema],
  },
  { timestamps: true }
);

export default mongoose.model(
  "MarketingCampaign",
  marketingCampaignSchema
);