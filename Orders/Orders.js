import crypto from "crypto";
import mongoose from "mongoose";
import { buildReviewLink, sendOrderReviewWhatsapp } from "../fast2sms/index.js";
import Counter from "../models/Counter.js";

const REVIEW_WHATSAPP_START_DATE = new Date(
  process.env.REVIEW_WHATSAPP_START_DATE || "2026-05-21T00:00:00.000Z",
);

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
      shippedQty: { type: Number, default: 0, min: 0 }, // shipped till now
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
    // ✅ pricing after order-level discount allocation
    originalPrice: { type: Number, default: 0 },
    originalSubtotal: { type: Number, default: 0 },

    discountAmount: { type: Number, default: 0 },

    // GST is INCLUDED in final discounted selling price
    taxRate: { type: Number, default: 5 },
    taxableValue: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
  },
  { _id: false },
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
  { _id: false },
);

const rmaSchema = new mongoose.Schema(
  {
    rmaNumber: { type: String, index: true }, // generated in pre-validate hook

    type: { type: String, enum: ["return", "exchange"], default: "return" },

    returnPickupCompleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    eligibleForRefund: {
      type: Boolean,
      default: false,
      index: true,
    },

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
    isFulfilled: {
      type: Boolean,
      default: false,
      index: true,
    },

    isExchangeOrderCreated: {
      type: Boolean,
      default: false,
      index: true,
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
    // ========================================================================
    // SHIPROCKET REVERSE PICKUP / RETURN TRACKING
    // ========================================================================
    reverseShipment: {
      provider: {
        type: String,
        enum: ["shiprocket", "manual"],
        default: "shiprocket",
      },

      // Shiprocket return-order identifiers
      orderId: {
        type: String,
        default: "",
      },

      shipmentId: {
        type: String,
        default: "",
      },

      // Selected courier details
      courierId: {
        type: Number,
        default: null,
      },

      courierName: {
        type: String,
        default: "",
      },

      courierRating: {
        type: Number,
        default: 0,
      },

      freightCharge: {
        type: Number,
        default: 0,
        min: 0,
      },

      estimatedDays: {
        type: String,
        default: "",
      },

      // AWB and customer tracking
      awb: {
        type: String,
        default: "",
      },

      trackingUrl: {
        type: String,
        default: "",
      },

      labelUrl: {
        type: String,
        default: "",
      },

      // Internal reverse-booking lifecycle
      status: {
        type: String,
        enum: [
          "not_booked",
          "checking_serviceability",
          "return_order_created",
          "awb_assigned",
          "pickup_scheduled",
          "picked",
          "in_transit",
          "received",
          "cancelled",
          "booking_failed",
        ],
        default: "not_booked",
      },

      rawStatus: {
        type: String,
        default: "",
      },

      statusCode: {
        type: String,
        default: "",
      },

      // Package details sent to Shiprocket
      package: {
        weight: {
          type: Number,
          default: 0,
          min: 0,
        },

        length: {
          type: Number,
          default: 0,
          min: 0,
        },

        breadth: {
          type: Number,
          default: 0,
          min: 0,
        },

        height: {
          type: Number,
          default: 0,
          min: 0,
        },

        declaredValue: {
          type: Number,
          default: 0,
          min: 0,
        },
      },

      // Pickup and movement dates
      pickupScheduledAt: {
        type: Date,
        default: null,
      },

      expectedPickupAt: {
        type: Date,
        default: null,
      },

      pickedAt: {
        type: Date,
        default: null,
      },

      inTransitAt: {
        type: Date,
        default: null,
      },

      receivedAt: {
        type: Date,
        default: null,
      },

      cancelledAt: {
        type: Date,
        default: null,
      },

      // Failure-safe retry information
      bookingError: {
        step: {
          type: String,
          enum: [
            "",
            "serviceability",
            "create_return_order",
            "assign_awb",
            "generate_pickup",
            "database_update",
            "customer_notification",
          ],
          default: "",
        },

        message: {
          type: String,
          default: "",
        },

        occurredAt: {
          type: Date,
          default: null,
        },
      },

      // Customer communication
      customerNotification: {
        emailSent: {
          type: Boolean,
          default: false,
        },

        emailSentAt: {
          type: Date,
          default: null,
        },

        emailError: {
          type: String,
          default: "",
        },

        whatsappSent: {
          type: Boolean,
          default: false,
        },

        whatsappSentAt: {
          type: Date,
          default: null,
        },

        whatsappError: {
          type: String,
          default: "",
        },
      },

      // Sync timestamps
      awbAssignedAt: {
        type: Date,
        default: null,
      },

      lastSyncedAt: {
        type: Date,
        default: null,
      },

      lastWebhookAt: {
        type: Date,
        default: null,
      },

      lastTrackAt: {
        type: Date,
        default: null,
      },

      // Raw Shiprocket responses for debugging
      rawServiceabilityResponse: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },

      rawCreateResponse: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },

      rawAwbResponse: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },

      rawPickupResponse: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },

      lastWebhook: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },

      lastTrack: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },
    },
  },
  { timestamps: true },
);

// ============================================================================
// UNIVERSAL ATTRIBUTION — snapshot stored on order at purchase time
// ============================================================================

const attributionTouchSchema = new mongoose.Schema(
  {
    source: { type: String, default: "" }, // facebook, google, instagram, whatsapp, organic, direct
    medium: { type: String, default: "" }, // paid_social, cpc, campaign, referral, organic, direct
    campaign: { type: String, default: "" },
    campaignSlug: { type: String, default: "" },

    content: { type: String, default: "" },
    term: { type: String, default: "" },

    pageUrl: { type: String, default: "" },
    landingUrl: { type: String, default: "" },
    referrer: { type: String, default: "" },

    capturedAt: { type: Date, default: null },
  },
  { _id: false },
);

const orderAttributionSchema = new mongoose.Schema(
  {
    // main readable fields for admin/report filters
    source: { type: String, default: "direct", index: true },
    medium: { type: String, default: "direct", index: true },
    campaign: { type: String, default: "", index: true },

    // first source that brought user
    firstTouch: attributionTouchSchema,

    // final source before order
    lastTouch: attributionTouchSchema,

    // current active session attribution
    session: attributionTouchSchema,

    // oatclub campaign system
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MarketingCampaign",
      default: null,
      index: true,
    },
    campaignSlug: { type: String, default: "", index: true },
    marketingLinkId: { type: String, default: "", index: true },
    shortCode: { type: String, default: "", index: true },

    // click ids from ad platforms
    clickIds: {
      fbclid: { type: String, default: "", index: true },
      gclid: { type: String, default: "", index: true },
      msclkid: { type: String, default: "", index: true },
      ttclid: { type: String, default: "", index: true },
      scClickId: { type: String, default: "", index: true },
    },

    // visitor/session identity
    visitorId: { type: String, default: "", index: true },
    sessionId: { type: String, default: "", index: true },

    // journey urls
    referrer: { type: String, default: "" },
    landingUrl: { type: String, default: "" },
    firstTouchUrl: { type: String, default: "" },
    lastTouchUrl: { type: String, default: "" },

    // technical snapshot
    device: {
      type: { type: String, default: "" }, // mobile / desktop / tablet
      browser: { type: String, default: "" },
      os: { type: String, default: "" },
      userAgent: { type: String, default: "" },
      ip: { type: String, default: "" },
    },

    // raw payload for future debugging
    raw: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    capturedAt: { type: Date, default: null },
    lastUpdatedAt: { type: Date, default: null },
  },
  { _id: false },
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
    orderType: {
      type: String,
      enum: ["parent", "shipment"],
      default: "shipment",
      index: true,
    },
    parentOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },
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

    walletCredit: {
      used: { type: Boolean, default: false, index: true },
      amount: { type: Number, default: 0, min: 0 },
      transactionId: { type: String, default: "", index: true },
      debitedAt: { type: Date, default: null },
      balanceAfterDebit: { type: Number, default: 0 },
    },

    walletReward: {
      earned: { type: Boolean, default: false, index: true },
      amount: { type: Number, default: 0, min: 0 },
      percent: { type: Number, default: 1, min: 0 },
      transactionId: { type: String, default: "", index: true },
      creditedAt: { type: Date, default: null },
      balanceAfterCredit: { type: Number, default: 0 },
    },

    partialPayment: {
      enabled: { type: Boolean, default: false, index: true },

      upfrontPercent: { type: Number, default: 0 },
      upfrontAmount: { type: Number, default: 0 },
      remainingCodAmount: { type: Number, default: 0 },

      upfrontPaid: { type: Boolean, default: false },
      upfrontPaidAt: { type: Date, default: null },

      razorpayOrderId: { type: String, default: "" },
      razorpayPaymentId: { type: String, default: "" },
    },

    paymentMethod: {
      type: String,
      enum: [
        "cod",
        "partial_cod",
        "razorpay",
        "exchange",
        "wallet",
        "manual_prepaid",
        "complimentary",
      ],
      default: "cod",
      index: true,
    },

    // ✅ FIX: added refund_pending to prevent crashes
    paymentStatus: {
      type: String,
      enum: [
        "pending",
        "partially_paid",
        "paid",
        "failed",
        "refunded",
        "partially_refunded",
        "refund_pending",
        "not_applicable",
      ],
      default: "pending",
      index: true,
    },

    eligibleForRefund: {
      type: Boolean,
      default: false,
      index: true,
    },

    isRefunded: {
      type: Boolean,
      default: false,
      index: true,
    },

    eligibleForRma: {
      type: Boolean,
      default: false,
      index: true,
    },

    isExchangeOrder: {
      type: Boolean,
      default: false,
      index: true,
    },

    hasExchangeOrder: {
      type: Boolean,
      default: false,
      index: true,
    },

    deliveryMethod: {
      type: String,
      enum: [
        "courier",
        "founders",
      ],
      default: "courier",
      index: true,
    },

    reviewRequest: {
      sent: { type: Boolean, default: false, index: true },
      sentAt: { type: Date, default: null },
      channel: { type: String, default: "fast2sms" },
      token: { type: String, default: "" },
      link: { type: String, default: "" },
      error: { type: String, default: "" },
    },

    refundSummary: {
      status: {
        type: String,
        enum: [
          "not_eligible",
          "eligible",
          "refund_pending",
          "processing",
          "refunded",
          "partially_refunded",
          "failed",
          "manual_required",
        ],
        default: "not_eligible",
        index: true,
      },

      refundType: {
        type: String,
        enum: ["full", "partial"],
        default: "full",
      },

      refundIds: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "OrderRefund",
        },
      ],

      lastRefundId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "OrderRefund",
        default: null,
      },

      lastRefundNumber: { type: String, default: "" },

      eligibleAmount: { type: Number, default: 0 },
      refundedAmount: { type: Number, default: 0 },
      pendingAmount: { type: Number, default: 0 },

      reason: { type: String, default: "" },
      adminNote: { type: String, default: "" },

      markedEligibleAt: { type: Date, default: null },
      refundRequestedAt: { type: Date, default: null },
      refundedAt: { type: Date, default: null },
      failedAt: { type: Date, default: null },
      failureReason: { type: String, default: "" },
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

        // reverse pickup (return/exchange)
        "pickup_initiated",

        "return_requested",
        "exchange_requested",
        "returned",
        "refunded",

        "exchanged",

        "cancelled",
        "rto",

        "failed",

        // ✅ ADD ONLY
        "delivery_failed",
        "return_pickup_completed",
      ],
      default: "processing",
      index: true,
    },

    fulfillmentDates: {
      processingAt: { type: Date, default: Date.now },
      packedAt: { type: Date, default: null },
      pickedAt: { type: Date, default: null },
      shippedAt: { type: Date, default: null },
      outForDeliveryAt: { type: Date, default: null },
      deliveredAt: { type: Date, default: null },
      pickupInitiatedAt: { type: Date, default: null },
      returnRequestedAt: { type: Date, default: null },
      exchangeRequestedAt: { type: Date, default: null },
      returnedAt: { type: Date, default: null },
      refundedAt: { type: Date, default: null },
      exchangedAt: { type: Date, default: null },
      rtoAt: { type: Date, default: null },
      failedAt: { type: Date, default: null },
      cancelledAt: { type: Date, default: null },

      // ✅ ADD ONLY
      deliveryFailedAt: { type: Date, default: null },
      returnPickupCompletedAt: { type: Date, default: null },
    },
    cancellation: {
      isCancelled: { type: Boolean, default: false },

      cancelledAt: { type: Date },

      cancelledBy: {
        type: String,
        enum: ["customer", "admin", "system"],
        default: undefined,
      },

      reason: {
        type: String,
        trim: true,
        default: "",
      },
    },

    shipment: {
      provider: {
        type: String,
        enum: [
          "unassigned",
          "shiprocket",
          "delhivery",
          "xpressbees",
          "eshipz",
          "manual",
        ],
        default: "unassigned",
        index: true,
      },

      // ✅ Universal fields for all partners
      orderId: { type: String, default: "", index: true },
      shipmentId: { type: String, default: "", index: true },
      awb: { type: String, default: "", index: true },
      courierName: { type: String, default: "" },
      trackingUrl: { type: String, default: "" },
      labelUrl: { type: String, default: "" },

      status: {
        type: String,
        enum: [
          "pending",
          "processing",
          "packed",
          "booked",
          "pickup_scheduled",
          "picked",
          "shipped",
          "in_transit",
          "out_for_delivery",
          "delivered",
          "rto",
          "cancelled",
          "failed",
        ],
        default: "pending",
        index: true,
      },

      rawStatus: { type: String, default: "" },
      statusCode: { type: String, default: "" },

      shippedAt: Date,
      deliveredAt: Date,
      pickedAt: Date,
      outForDeliveryAt: Date,
      rtoAt: Date,
      cancelledAt: Date,
      failedAt: Date,

      lastSyncedAt: { type: Date, default: null },
      lastWebhookAt: { type: Date, default: null },
      lastTrackAt: { type: Date, default: null },

      lastWebhook: { type: mongoose.Schema.Types.Mixed, default: null },
      lastTrack: { type: mongoose.Schema.Types.Mixed, default: null },

      shiprocket: {
        orderId: { type: String, default: "" },
        shipmentId: { type: String, default: "" },
        awb: { type: String, default: "", index: true },
        courierName: { type: String, default: "" },
        trackingUrl: { type: String, default: "" },
        labelUrl: { type: String, default: "" },

        lastWebhook: { type: mongoose.Schema.Types.Mixed, default: null },
        lastTrack: { type: mongoose.Schema.Types.Mixed, default: null },
      },

      delhivery: {
        waybill: {
          type: String,
          default: "",
          index: true,
        },

        orderId: {
          type: String,
          default: "",
          index: true,
        },

        courierName: {
          type: String,
          default: "Delhivery",
        },

        trackingUrl: {
          type: String,
          default: "",
        },

        labelUrl: {
          type: String,
          default: "",
        },

        rawStatus: {
          type: String,
          default: "",
        },

        statusCode: {
          type: String,
          default: "",
        },

        lastWebhook: {
          type: mongoose.Schema.Types.Mixed,
          default: null,
        },

        lastTrack: {
          type: mongoose.Schema.Types.Mixed,
          default: null,
        },

        rawBookingResponse: {
          type: mongoose.Schema.Types.Mixed,
          default: null,
        },
      },

      xpressbees: {
        shipmentId: { type: String, default: "", index: true },
        awb: { type: String, default: "", index: true },
        labelUrl: { type: String, default: "" },
        courierName: { type: String, default: "XpressBees" },
        trackingUrl: { type: String, default: "" },

        lastWebhook: { type: mongoose.Schema.Types.Mixed, default: null },
        lastTrack: { type: mongoose.Schema.Types.Mixed, default: null },
      },

      // ✅ eShipz partner data
      eshipz: {
        orderId: { type: String, default: "", index: true },
        shipmentId: { type: String, default: "", index: true },
        awb: { type: String, default: "", index: true },

        courierName: { type: String, default: "" }, // BlueDart etc.
        carrierId: { type: String, default: "" },
        serviceType: { type: String, default: "" },

        trackingUrl: { type: String, default: "" },
        labelUrl: { type: String, default: "" },
        invoiceUrl: { type: String, default: "" },
        manifestUrl: { type: String, default: "" },

        status: { type: String, default: "" },
        statusCode: { type: String, default: "" },

        expectedDelivery: { type: Date, default: null },

        lastWebhook: { type: mongoose.Schema.Types.Mixed, default: null },
        lastTrack: { type: mongoose.Schema.Types.Mixed, default: null },
        rawBookingResponse: {
          type: mongoose.Schema.Types.Mixed,
          default: null,
        },
      },
    },

    trackingDetails: {
      trackingId: { type: String, default: "", index: true },
      awb: { type: String, default: "", index: true },
      provider: { type: String, default: "" },
      courierName: { type: String, default: "" },
      trackingUrl: { type: String, default: "" },

      shippedAt: Date,
      deliveredAt: Date,
      expectedDelivery: Date,

      lastUpdatedAt: { type: Date, default: null },
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

    // ✅ Universal attribution snapshot
    attribution: {
      type: orderAttributionSchema,
      default: () => ({
        source: "direct",
        medium: "direct",
        campaign: "",
        capturedAt: new Date(),
        lastUpdatedAt: new Date(),
      }),
    },

    priority: {
      type: String,
      enum: ["normal", "medium", "high"],
      default: "normal",
      index: true,
    },

    isGiftOrder: { type: Boolean, default: false },
    isInfluencerOrder: {
      type: Boolean,
      default: false,
      index: true,
    },
    // ✅ order confirmation (separate from fulfillment)
    isConfirmed: { type: Boolean, default: false, index: true },
    isPackable: {
      type: Boolean,
      default: false,
      index: true,
    },
    confirmedAt: { type: Date, default: null },
    confirmedBy: {
      type: String,
      enum: ["auto", "customer", "admin"],
      default: null,
      index: true,
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
  { timestamps: true },
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
      { new: true, upsert: true },
    );

    this.orderNumber = String(counter.seq).padStart(6, "0");

    next();
  } catch (err) {
    next(err);
  }
});

const hasChildren = async (orderId) => {
  const exists = await mongoose
    .model("Order")
    .exists({ parentOrderId: orderId });
  return Boolean(exists);
};

// ========================================================================================
// 🎁 INFLUENCER ORDER → AUTO COMPLIMENTARY
// No payment / no COD collection
// ========================================================================================
orderSchema.pre("validate", function (next) {
  try {
    if (this.isInfluencerOrder === true) {
      this.paymentMethod = "complimentary";
      this.paymentStatus = "not_applicable";

      // Never keep COD / Razorpay collection amounts
      if (this.paymentBreakdown) {
        this.paymentBreakdown.codAmount = 0;
        this.paymentBreakdown.razorpayAmount = 0;
      }

      // Disable any old Partial COD state
      if (this.partialPayment) {
        this.partialPayment.enabled = false;
        this.partialPayment.upfrontPercent = 0;
        this.partialPayment.upfrontAmount = 0;
        this.partialPayment.remainingCodAmount = 0;
        this.partialPayment.upfrontPaid = false;
        this.partialPayment.upfrontPaidAt = null;
        this.partialPayment.razorpayOrderId = "";
        this.partialPayment.razorpayPaymentId = "";
      }
    }

    next();
  } catch (e) {
    next(e);
  }
});

// ========================================================================================
// ✅ AUTO-CONFIRM
// - Full Razorpay payment -> auto confirm
// - Partial COD -> auto confirm only after upfront payment is received
// ========================================================================================
orderSchema.pre("validate", function (next) {
  try {
    const isRazorpayPaid =
      this.paymentMethod === "razorpay" &&
      this.paymentStatus === "paid";

    const isPartialCodPaid =
      this.paymentMethod === "partial_cod" &&
      this.paymentStatus === "partially_paid" &&
      this.partialPayment?.upfrontPaid === true;

    if ((isRazorpayPaid || isPartialCodPaid) && !this.isConfirmed) {
      this.isConfirmed = true;
      this.confirmedAt = new Date();
      this.confirmedBy = "auto";
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
        { new: true, upsert: true },
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
        attrs.find((a) => String(a?.key || "").toLowerCase() === "size")
          ?.value ||
        attrs.find((a) => String(a?.key || "").toLowerCase() === "sizes")
          ?.value ||
        "";

      const color =
        attrs.find((a) => String(a?.key || "").toLowerCase() === "color")
          ?.value ||
        attrs.find((a) => String(a?.key || "").toLowerCase() === "colour")
          ?.value ||
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
// Discount distributed proportionally across items
// GST = flat 5% INCLUDED in discounted product value
// ========================================================================================
orderSchema.pre("validate", function (next) {
  try {
    const GST_RATE = 5;
    const GST_DIVISOR = 1 + GST_RATE / 100;

    const round2 = (n) =>
      Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

    // ------------------------------------------------------------------
    // 1. NORMALIZE ORIGINAL ITEMS
    // ------------------------------------------------------------------

    const normalizedItems = (this.items || []).map((it) => {
      const qty = Math.max(1, Number(it.quantity || 1));

      // Once originalPrice exists, always use it as source of truth.
      // This prevents repeated saves from discounting an already
      // discounted price again.
      const originalPrice =
        Number(it.originalPrice || 0) > 0
          ? Number(it.originalPrice)
          : Number(it.price || 0);

      const originalSubtotal = round2(originalPrice * qty);

      return {
        ...it,
        quantity: qty,

        originalPrice: round2(originalPrice),
        originalSubtotal,

        // temporarily original; discounted values assigned below
        price: round2(originalPrice),
        subtotal: originalSubtotal,

        discountAmount: 0,
        taxRate: GST_RATE,
        taxableValue: 0,
        taxAmount: 0,
      };
    });

    const grossSubtotal = round2(
      normalizedItems.reduce(
        (sum, it) => sum + Number(it.originalSubtotal || 0),
        0
      )
    );

    // ------------------------------------------------------------------
    // EXCHANGE SAFETY
    // ------------------------------------------------------------------

    if (this.paymentMethod === "exchange") {
      this.items = normalizedItems.map((it) => {
        const taxableValue = round2(it.subtotal / GST_DIVISOR);
        const taxAmount = round2(it.subtotal - taxableValue);

        return {
          ...it,
          taxableValue,
          taxAmount,
        };
      });

      this.subtotal = grossSubtotal;
      this.discount = 0;
      this.shippingFee = 0;

      this.tax = round2(
        this.items.reduce((sum, it) => sum + Number(it.taxAmount || 0), 0)
      );

      this.totalAmount = grossSubtotal;
      this.finalPayable = 0;
      this.paymentStatus = "not_applicable";

      this.walletCredit = this.walletCredit || {};
      this.paymentBreakdown = this.paymentBreakdown || {};
      this.analytics = this.analytics || {};

      this.walletCredit.used = false;
      this.walletCredit.amount = 0;

      this.paymentBreakdown.walletAmount = 0;
      this.paymentBreakdown.razorpayAmount = 0;
      this.paymentBreakdown.codAmount = 0;

      this.analytics.creditsUsed = false;

      if (!this.isConfirmed) {
        this.isConfirmed = true;
        this.confirmedAt = new Date();
        this.confirmedBy = "auto";
      }

      const totalItems = this.items.reduce(
        (sum, it) => sum + Number(it.quantity || 0),
        0
      );

      this.analytics.totalItems = totalItems;
      this.analytics.averageItemPrice = totalItems
        ? grossSubtotal / totalItems
        : 0;

      return next();
    }

    // ------------------------------------------------------------------
    // 2. ORDER DISCOUNT
    // ------------------------------------------------------------------

    const requestedDiscount = Math.max(
      0,
      Number(this.discount || this.coupon?.discount || 0)
    );

    // Discount cannot exceed product subtotal
    const discount = round2(
      Math.min(requestedDiscount, grossSubtotal)
    );

    this.discount = discount;

    // ------------------------------------------------------------------
    // 3. SCATTER DISCOUNT PROPORTIONATELY ACROSS ITEMS
    // ------------------------------------------------------------------

    let allocatedDiscount = 0;

    this.items = normalizedItems.map((it, index) => {
      let itemDiscount = 0;

      if (discount > 0 && grossSubtotal > 0) {
        // Last item receives rounding remainder
        if (index === normalizedItems.length - 1) {
          itemDiscount = round2(discount - allocatedDiscount);
        } else {
          itemDiscount = round2(
            discount * (it.originalSubtotal / grossSubtotal)
          );

          allocatedDiscount = round2(
            allocatedDiscount + itemDiscount
          );
        }
      }

      itemDiscount = Math.min(
        itemDiscount,
        it.originalSubtotal
      );

      // final GST-inclusive value after discount
      const discountedSubtotal = round2(
        it.originalSubtotal - itemDiscount
      );

      const discountedUnitPrice = round2(
        discountedSubtotal / it.quantity
      );

      // 5% GST INCLUDED
      const taxableValue = round2(
        discountedSubtotal / GST_DIVISOR
      );

      const taxAmount = round2(
        discountedSubtotal - taxableValue
      );

      return {
        ...it,

        // IMPORTANT:
        // price/subtotal now represent actual discounted selling value
        price: discountedUnitPrice,
        subtotal: discountedSubtotal,

        discountAmount: itemDiscount,

        taxRate: GST_RATE,
        taxableValue,
        taxAmount,
      };
    });

    // ------------------------------------------------------------------
    // 4. FINAL PRODUCT VALUES
    // ------------------------------------------------------------------

    const discountedProductTotal = round2(
      this.items.reduce(
        (sum, it) => sum + Number(it.subtotal || 0),
        0
      )
    );

    const totalTax = round2(
      this.items.reduce(
        (sum, it) => sum + Number(it.taxAmount || 0),
        0
      )
    );

    const shippingFee = round2(
      Math.max(0, Number(this.shippingFee || 0))
    );

    // subtotal = original product value before discount
    this.subtotal = grossSubtotal;

    // tax is INCLUDED, not added again
    this.tax = totalTax;

    // totalAmount = discounted goods + shipping
    this.totalAmount = round2(
      discountedProductTotal + shippingFee
    );

    // ------------------------------------------------------------------
    // 5. WALLET
    // ------------------------------------------------------------------

    const beforeWalletPayable = this.totalAmount;

    const requestedWalletAmount = Number(
      this.walletCredit?.amount ||
      this.paymentBreakdown?.walletAmount ||
      0
    );

    const walletAmount = round2(
      Math.min(
        Math.max(0, requestedWalletAmount),
        beforeWalletPayable
      )
    );

    this.finalPayable = round2(
      Math.max(0, beforeWalletPayable - walletAmount)
    );

    this.walletCredit = this.walletCredit || {};
    this.paymentBreakdown = this.paymentBreakdown || {};
    this.analytics = this.analytics || {};

    this.walletCredit.used = walletAmount > 0;
    this.walletCredit.amount = walletAmount;

    this.paymentBreakdown.walletAmount = walletAmount;

    this.analytics.creditsUsed = walletAmount > 0;

    if (walletAmount > 0 && this.finalPayable === 0) {
      this.paymentMethod = "wallet";
      this.paymentStatus = "paid";

      if (!this.isConfirmed) {
        this.isConfirmed = true;
        this.confirmedAt = new Date();
        this.confirmedBy = "auto";
      }
    }

    // ------------------------------------------------------------------
    // 6. ANALYTICS
    // ------------------------------------------------------------------

    const totalItems = this.items.reduce(
      (sum, it) => sum + Number(it.quantity || 0),
      0
    );

    this.analytics.totalItems = totalItems;

    this.analytics.averageItemPrice = totalItems
      ? round2(discountedProductTotal / totalItems)
      : 0;

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

  return this.findByIdAndUpdate(orderId, update, {
    new: true,
    runValidators: true,
  });
};

// ========================================================================================
// ✅ PATCH 4: Safety guard — prevent shipping stages unless confirmed
// ✅ PLUS: Parent order can't be shipped (only shipment split orders can)
// ========================================================================================
orderSchema.pre("validate", async function (next) {
  try {
    const shippingStages = [
      "packed",
      "picked",
      "shipped",
      "out_for_delivery",
      "delivered",
    ];

    // 1) Nothing can move to shipping unless confirmed
    if (!this.isConfirmed && shippingStages.includes(this.fulfillmentStatus)) {
      return next(new Error("Order must be confirmed before shipping stages"));
    }

    if (
      !this.isConfirmed &&
      this.shipment?.status &&
      shippingStages.includes(this.shipment.status)
    ) {
      return next(
        new Error("Order must be confirmed before shipment status moves"),
      );
    }

    // ✅ 2) Parent can be blocked ONLY if it actually has children
    const isMarkedParent =
      String(this.orderType || "").toLowerCase() === "parent";
    let actuallySplitParent = false;

    if (isMarkedParent && this._id) {
      const OrderModel = mongoose.model("Order");
      const childExists = await OrderModel.exists({ parentOrderId: this._id });
      actuallySplitParent = Boolean(childExists);
    }

    if (
      actuallySplitParent &&
      shippingStages.includes(this.fulfillmentStatus)
    ) {
      return next(
        new Error(
          "Split parent order cannot be shipped. Ship child orders (-A/-B) only.",
        ),
      );
    }

    if (
      actuallySplitParent &&
      this.shipment?.status &&
      shippingStages.includes(this.shipment.status)
    ) {
      return next(
        new Error(
          "Split parent order shipment status cannot move. Ship only child orders.",
        ),
      );
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

// ========================================================================================
// ✅ AUTO-CALC RMA ELIGIBILITY WINDOW
// - Delivered orders are RMA eligible for 7 days
// - After 7 days, eligibleForRma becomes false
// - Review message sending will be handled by cron/service later
// ========================================================================================
orderSchema.pre("validate", function (next) {
  try {
    const isDelivered =
      this.fulfillmentStatus === "delivered" ||
      this.shipment?.status === "delivered";

    const deliveredAt =
      this.fulfillmentDates?.deliveredAt ||
      this.shipment?.deliveredAt ||
      this.trackingDetails?.deliveredAt;

    if (!isDelivered || !deliveredAt) {
      this.eligibleForRma = false;
      return next();
    }

    const deliveredTime = new Date(deliveredAt).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const rmaExpired = Date.now() - deliveredTime >= sevenDaysMs;

    this.eligibleForRma = !rmaExpired;

    next();
  } catch (err) {
    next(err);
  }
});

// ========================================================================================
// ✅ AUTO-CALC isPackable (based on fulfillment)
// ========================================================================================
orderSchema.pre("validate", function (next) {
  try {
    if (!this.isConfirmed || !Array.isArray(this.items)) {
      this.isPackable = false;
      return next();
    }

    this.isPackable = this.items.every(
      (item) => Number(item?.fulfillment?.toProduceQty || 0) === 0,
    );

    next();
  } catch (e) {
    next(e);
  }
});

const FULFILLMENT_DATE_FIELD = {
  processing: "processingAt",
  packed: "packedAt",
  picked: "pickedAt",
  shipped: "shippedAt",
  out_for_delivery: "outForDeliveryAt",
  delivered: "deliveredAt",

  pickup_initiated: "pickupInitiatedAt",
  return_requested: "returnRequestedAt",
  exchange_requested: "exchangeRequestedAt",
  returned: "returnedAt",
  refunded: "refundedAt",
  exchanged: "exchangedAt",

  cancelled: "cancelledAt",
  rto: "rtoAt",
  failed: "failedAt",

  // ✅ ADD ONLY
  delivery_failed: "deliveryFailedAt",
  return_pickup_completed: "returnPickupCompletedAt",
};

orderSchema.pre("validate", function (next) {
  try {
    if (!this.fulfillmentDates) this.fulfillmentDates = {};

    if (this.isModified("fulfillmentStatus")) {
      const field = FULFILLMENT_DATE_FIELD[this.fulfillmentStatus];
      if (field) this.fulfillmentDates[field] = new Date();

      if (!this.cancellation) this.cancellation = {};

      if (this.fulfillmentStatus === "cancelled") {
        this.cancellation.isCancelled = true;
        this.cancellation.cancelledAt =
          this.fulfillmentDates?.cancelledAt || new Date();
      } else {
        // ✅ status changed from cancelled to anything else
        // clear cancellation completely
        this.cancellation.isCancelled = false;
        this.cancellation.cancelledAt = undefined;
        this.cancellation.cancelledBy = undefined;
        this.cancellation.reason = "";

        // ✅ remove timeline cancelled date too
        this.fulfillmentDates.cancelledAt = null;
      }
    }

    next();
  } catch (err) {
    next(err);
  }
});

// ========================================================================================
// ✅ AUTO-MARK REFUND PENDING WHEN PAID RAZORPAY ORDER IS CANCELLED / RTO
// ========================================================================================
orderSchema.pre("validate", function (next) {
  try {
    const status = String(this.fulfillmentStatus || "").toLowerCase();

    const isRefundTriggerStatus = ["cancelled", "rto"].includes(status);

    const wasPaidRazorpay =
      this.paymentMethod === "razorpay" &&
      this.paymentStatus === "paid" &&
      this.razorpay?.paymentId;

    if (isRefundTriggerStatus && wasPaidRazorpay) {
      const amount = Number(this.finalPayable || 0);

      this.eligibleForRefund = true;
      this.paymentStatus = "refund_pending";

      this.refundSummary = {
        ...(this.refundSummary || {}),
        status: "refund_pending",
        refundType: "full",
        eligibleAmount: amount,
        refundedAmount: Number(this.refundSummary?.refundedAmount || 0),
        pendingAmount: amount,
        reason:
          this.refundSummary?.reason ||
          this.cancellation?.reason ||
          (status === "rto"
            ? "Paid Razorpay order returned to origin"
            : "Paid order cancelled before shipment"),
        markedEligibleAt: this.refundSummary?.markedEligibleAt || new Date(),
        refundRequestedAt: this.refundSummary?.refundRequestedAt || new Date(),
      };
    }

    next();
  } catch (err) {
    next(err);
  }
});

// ========================================================================================
// ✅ AUTO-NORMALIZE UNIVERSAL ATTRIBUTION
// ========================================================================================
orderSchema.pre("validate", function (next) {
  try {
    if (!this.attribution) {
      this.attribution = {};
    }

    const attr = this.attribution || {};

    const clean = (v = "") => String(v || "").trim();
    const lower = (v = "") => clean(v).toLowerCase();

    const firstTouch = attr.firstTouch || {};
    const lastTouch = attr.lastTouch || {};
    const session = attr.session || {};

    const source =
      lower(attr.source) ||
      lower(lastTouch.source) ||
      lower(session.source) ||
      lower(firstTouch.source) ||
      "direct";

    const medium =
      lower(attr.medium) ||
      lower(lastTouch.medium) ||
      lower(session.medium) ||
      lower(firstTouch.medium) ||
      "direct";

    const campaign =
      clean(attr.campaign) ||
      clean(lastTouch.campaign) ||
      clean(session.campaign) ||
      clean(firstTouch.campaign) ||
      "";

    this.attribution.source = source;
    this.attribution.medium = medium;
    this.attribution.campaign = campaign;

    this.attribution.referrer =
      clean(attr.referrer) ||
      clean(lastTouch.referrer) ||
      clean(firstTouch.referrer);

    this.attribution.landingUrl =
      clean(attr.landingUrl) ||
      clean(firstTouch.landingUrl) ||
      clean(firstTouch.pageUrl);

    this.attribution.firstTouchUrl =
      clean(attr.firstTouchUrl) ||
      clean(firstTouch.pageUrl) ||
      clean(firstTouch.landingUrl);

    this.attribution.lastTouchUrl =
      clean(attr.lastTouchUrl) ||
      clean(lastTouch.pageUrl) ||
      clean(lastTouch.landingUrl) ||
      clean(session.pageUrl);

    if (!this.attribution.capturedAt) {
      this.attribution.capturedAt = new Date();
    }

    this.attribution.lastUpdatedAt = new Date();

    next();
  } catch (err) {
    next(err);
  }
});

// ========================================================================================
// ✅ SEND REVIEW WHATSAPP WHEN RMA WINDOW EXPIRES
// ========================================================================================
orderSchema.statics.sendReviewRequestWhatsapp = async function (orderId) {
  const order = await this.findById(orderId).populate("customerId");

  if (!order) {
    return { success: false, skipped: true, reason: "Order not found" };
  }

  const isDelivered =
    order.fulfillmentStatus === "delivered" ||
    order.shipment?.status === "delivered";

  if (!isDelivered) {
    return { success: false, skipped: true, reason: "Order not delivered" };
  }

  const createdAt = order.createdAt ? new Date(order.createdAt) : null;

  if (!createdAt || createdAt < REVIEW_WHATSAPP_START_DATE) {
    return {
      success: false,
      skipped: true,
      reason: "Order created before review WhatsApp start date",
    };
  }

  if (order.eligibleForRma) {
    return {
      success: false,
      skipped: true,
      reason: "RMA window still active",
    };
  }

  if (order.reviewRequest?.sent) {
    return {
      success: true,
      skipped: true,
      reason: "Review WhatsApp already sent",
    };
  }

  const reviewLink = buildReviewLink(order.orderNumber);

  try {
    const response = await sendOrderReviewWhatsapp({ order });

    await this.updateOne(
      { _id: order._id },
      {
        $set: {
          "reviewRequest.sent": true,
          "reviewRequest.sentAt": new Date(),
          "reviewRequest.channel": "fast2sms",
          "reviewRequest.link": reviewLink,
          "reviewRequest.error": "",
        },
      },
    );

    return {
      success: true,
      skipped: false,
      response,
    };
  } catch (err) {
    await this.updateOne(
      { _id: order._id },
      {
        $set: {
          "reviewRequest.sent": false,
          "reviewRequest.channel": "fast2sms",
          "reviewRequest.link": reviewLink,
          "reviewRequest.error": err.message || "Review WhatsApp failed",
        },
      },
    );

    return {
      success: false,
      skipped: false,
      error: err.message,
    };
  }
};

orderSchema.post("save", function (doc) {
  const createdAt = doc.createdAt ? new Date(doc.createdAt) : null;

  if (!createdAt || createdAt < REVIEW_WHATSAPP_START_DATE) {
    return;
  }

  const isDelivered =
    doc.fulfillmentStatus === "delivered" ||
    doc.shipment?.status === "delivered";

  const shouldSendReview =
    isDelivered && doc.eligibleForRma === false && !doc.reviewRequest?.sent;

  if (!shouldSendReview) return;

  setImmediate(async () => {
    try {
      await doc.constructor.sendReviewRequestWhatsapp(doc._id);
    } catch (err) {
      console.error("❌ Review WhatsApp auto-send failed:", err.message);
    }
  });
});


orderSchema.pre("validate", function (next) {
  try {
    if (this.paymentMethod === "complimentary") {
      this.paymentStatus = "not_applicable";

      if (this.paymentBreakdown) {
        this.paymentBreakdown.codAmount = 0;
        this.paymentBreakdown.razorpayAmount = 0;
      }

      if (this.partialPayment) {
        this.partialPayment.remainingCodAmount = 0;
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Core list performance
orderSchema.index({ createdAt: -1 });
orderSchema.index({ priorityRank: -1, createdAt: -1 });

// Common admin filters
orderSchema.index({ isConfirmed: 1, createdAt: -1 });
orderSchema.index({ fulfillmentStatus: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ paymentMethod: 1, createdAt: -1 });
orderSchema.index({ customerId: 1, createdAt: -1 });

// Range queries
orderSchema.index({ finalPayable: 1, createdAt: -1 });

// Shipment dashboards
orderSchema.index({ "shipment.status": 1, createdAt: -1 });

// Existing useful ones
orderSchema.index({ "trackingDetails.trackingId": 1 });
orderSchema.index({ "items.lineId": 1 });

// Split orders
orderSchema.index({ orderType: 1, parentOrderId: 1 });
orderSchema.index({ parentOrderId: 1, splitSuffix: 1 });

// RMA queries
orderSchema.index({ "rmas.rmaNumber": 1 });
orderSchema.index({ "rmas.status": 1 });
orderSchema.index({ "rmas.items.orderLineId": 1 });
orderSchema.index({ "rmas.fee.status": 1 });

orderSchema.index({ "rmas.reverseShipment.orderId": 1 });
orderSchema.index({ "rmas.reverseShipment.shipmentId": 1 });
orderSchema.index({ "rmas.reverseShipment.awb": 1 });
orderSchema.index({ "rmas.reverseShipment.courierId": 1 });
orderSchema.index({
  "rmas.reverseShipment.status": 1,
  createdAt: -1,
});
orderSchema.index({
  "rmas.reverseShipment.customerNotification.emailSent": 1,
  createdAt: -1,
});

// Xpressbees
orderSchema.index({ "shipment.xpressbees.awb": 1 });
orderSchema.index({ "shipment.xpressbees.shipmentId": 1 });

// Refund queries
orderSchema.index({ eligibleForRefund: 1, createdAt: -1 });
orderSchema.index({ "refundSummary.status": 1, createdAt: -1 });

// Universal attribution analytics
orderSchema.index({ "attribution.source": 1, createdAt: -1 });
orderSchema.index({ "attribution.medium": 1, createdAt: -1 });
orderSchema.index({ "attribution.campaign": 1, createdAt: -1 });
orderSchema.index({ "attribution.campaignId": 1, createdAt: -1 });
orderSchema.index({ "attribution.campaignSlug": 1, createdAt: -1 });
orderSchema.index({ "attribution.marketingLinkId": 1, createdAt: -1 });
orderSchema.index({ "attribution.shortCode": 1, createdAt: -1 });
orderSchema.index({ "attribution.visitorId": 1, createdAt: -1 });
orderSchema.index({ "attribution.sessionId": 1, createdAt: -1 });
orderSchema.index({ "attribution.clickIds.fbclid": 1 });
orderSchema.index({ "attribution.clickIds.gclid": 1 });
orderSchema.index({ "attribution.clickIds.msclkid": 1 });
orderSchema.index({ "attribution.clickIds.ttclid": 1 });
orderSchema.index({ "attribution.clickIds.scClickId": 1 });

// Shipment partner queries
orderSchema.index({ "shipment.provider": 1, createdAt: -1 });
orderSchema.index({ "shipment.status": 1, createdAt: -1 });
orderSchema.index({ "shipment.awb": 1 });
orderSchema.index({ "shipment.shipmentId": 1 });
orderSchema.index({ "shipment.orderId": 1 });

// eShipz
orderSchema.index({ "shipment.eshipz.awb": 1 });
orderSchema.index({ "shipment.eshipz.shipmentId": 1 });
orderSchema.index({ "shipment.eshipz.orderId": 1 });
orderSchema.index({ "shipment.eshipz.courierName": 1, createdAt: -1 });

orderSchema.index({ "shipment.delhivery.waybill": 1 });
orderSchema.index({ "shipment.delhivery.orderId": 1 });

// Xpressbees
orderSchema.index({ "shipment.xpressbees.awb": 1 });
orderSchema.index({ "shipment.xpressbees.shipmentId": 1 });

// Tracking
orderSchema.index({ "trackingDetails.awb": 1 });
orderSchema.index({ "trackingDetails.trackingId": 1 });

// RMA / Review request queries
orderSchema.index({ eligibleForRma: 1, createdAt: -1 });
orderSchema.index({ "reviewRequest.sent": 1, createdAt: -1 });
orderSchema.index({ "reviewRequest.token": 1 });

orderSchema.index({ "walletCredit.used": 1, createdAt: -1 });
orderSchema.index({ "walletCredit.transactionId": 1 });
orderSchema.index({ "paymentBreakdown.walletAmount": -1, createdAt: -1 });
orderSchema.index({ "walletReward.earned": 1, createdAt: -1 });
orderSchema.index({ "walletReward.transactionId": 1 });

export default mongoose.models.Order || mongoose.model("Order", orderSchema);
