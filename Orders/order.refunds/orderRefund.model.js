import mongoose from "mongoose";
import crypto from "crypto";
import Counter from "../../models/Counter.js";

const refundProofSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["screenshot", "receipt", "upi_proof", "bank_proof", "other"],
      default: "screenshot",
    },
    url: { type: String, required: true },
    publicId: { type: String, default: "" },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    note: { type: String, default: "" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const refundItemSchema = new mongoose.Schema(
  {
    lineId: { type: String, default: "", index: true },

    productModel: {
      type: String,
      enum: ["Product", "Footwear"],
      default: "Product",
    },

    productId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "items.productModel",
      default: null,
      index: true,
    },

    productCode: { type: String, default: "", index: true },
    title: { type: String, default: "" },
    sku: { type: String, default: "" },
    selectedSize: { type: String, default: "" },
    selectedColor: { type: String, default: "" },
    thumbnail: { type: String, default: "" },

    quantity: { type: Number, default: 1, min: 1 },
    price: { type: Number, default: 0, min: 0 },
    subtotal: { type: Number, default: 0, min: 0 },

    refundAmount: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const orderRefundSchema = new mongoose.Schema(
  {
    refundNumber: {
      type: String,
      unique: true,
      index: true,
    },

    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },

    orderNumber: {
      type: String,
      required: true,
      index: true,
    },

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },

    rmaNumber: { type: String, default: "", index: true },

    paymentMethod: {
      type: String,
      enum: ["razorpay", "cod", "exchange"],
      required: true,
      index: true,
    },

    refundMode: {
      type: String,
      enum: ["automatic", "manual"],
      required: true,
      index: true,
    },

    refundMethod: {
      type: String,
      enum: [
        "razorpay_source",
        "razorpayx_payout",
        "upi",
        "bank_transfer",
        "cash",
        "store_credit",
        "other",
      ],
      required: true,
      index: true,
    },

    refundType: {
      type: String,
      enum: ["full", "partial"],
      default: "full",
      index: true,
    },

    items: {
      type: [refundItemSchema],
      default: [],
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: "INR",
    },

    status: {
      type: String,
      enum: [
        "created",
        "approved",
        "processing",
        "processed",
        "failed",
        "cancelled",
        "manual_required",
      ],
      default: "created",
      index: true,
    },

    reason: { type: String, default: "" },
    adminNote: { type: String, default: "" },

    customerVisible: {
      type: Boolean,
      default: true,
      index: true,
    },

    customerMessage: {
      type: String,
      default: "",
    },

    notification: {
      customerNotified: { type: Boolean, default: false },
      notifiedAt: { type: Date, default: null },
      channel: {
        type: String,
        enum: ["email", "sms", "whatsapp", "manual", ""],
        default: "",
      },
      lastMessage: { type: String, default: "" },
    },

    razorpay: {
      paymentId: { type: String, default: "", index: true },
      refundId: { type: String, default: "", index: true },
      speed: {
        type: String,
        enum: ["normal", "optimum", ""],
        default: "",
      },
      receipt: { type: String, default: "" },
      rawResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    },

    payout: {
      provider: {
        type: String,
        enum: ["razorpayx", "manual", ""],
        default: "",
      },
      contactId: { type: String, default: "" },
      fundAccountId: { type: String, default: "" },
      payoutId: { type: String, default: "", index: true },
      payoutLinkId: { type: String, default: "", index: true },
      utr: { type: String, default: "" },
    },

    manualRefund: {
      transactionId: { type: String, default: "", index: true },
      utr: { type: String, default: "", index: true },
      paidFrom: { type: String, default: "" },
      paidTo: { type: String, default: "" },
      paidAt: { type: Date, default: null },
      handledByName: { type: String, default: "" },
    },

    customerRefundDetails: {
      mode: {
        type: String,
        enum: ["upi", "bank", "cash", "store_credit", ""],
        default: "",
      },
      upiId: { type: String, default: "" },
      accountHolderName: { type: String, default: "" },
      bankName: { type: String, default: "" },
      accountNumberLast4: { type: String, default: "" },
      ifsc: { type: String, default: "" },
      note: { type: String, default: "" },
    },

    proofs: {
      type: [refundProofSchema],
      default: [],
    },

    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },

    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },

    approvedAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    failureReason: { type: String, default: "" },

    idempotencyKey: {
      type: String,
      default: () => crypto.randomUUID(),
      index: true,
    },
  },
  { timestamps: true }
);

orderRefundSchema.pre("validate", async function (next) {
  if (this.refundNumber) return next();

  try {
    const counter = await Counter.findOneAndUpdate(
      { name: "refund" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    this.refundNumber = `REF-${String(counter.seq).padStart(6, "0")}`;
    next();
  } catch (err) {
    next(err);
  }
});

orderRefundSchema.pre("validate", function (next) {
  try {
    if (this.paymentMethod === "razorpay") {
      this.refundMode = "automatic";
      this.refundMethod = "razorpay_source";
    }

    if (this.paymentMethod === "cod" && this.refundMode !== "manual") {
      this.refundMode = "manual";
    }

    const itemAmount = Array.isArray(this.items)
      ? this.items.reduce((sum, item) => sum + Number(item.refundAmount || 0), 0)
      : 0;

    if (this.refundType === "partial" && itemAmount > 0) {
      this.amount = itemAmount;
    }

    if (this.refundType === "partial" && (!this.items || this.items.length === 0)) {
      this.items = [];
    }

    if (this.status === "processed" && !this.processedAt) {
      this.processedAt = new Date();
    }

    if (this.status === "failed" && !this.failedAt) {
      this.failedAt = new Date();
    }

    if (this.status === "approved" && !this.approvedAt) {
      this.approvedAt = new Date();
    }

    if (this.status === "cancelled" && !this.cancelledAt) {
      this.cancelledAt = new Date();
    }

    if (
      this.refundMode === "manual" &&
      this.status === "processed" &&
      !this.manualRefund.paidAt
    ) {
      this.manualRefund.paidAt = new Date();
    }

    next();
  } catch (err) {
    next(err);
  }
});

orderRefundSchema.index({ orderId: 1, createdAt: -1 });
orderRefundSchema.index({ orderNumber: 1, createdAt: -1 });
orderRefundSchema.index({ customerId: 1, createdAt: -1 });
orderRefundSchema.index({ status: 1, createdAt: -1 });
orderRefundSchema.index({ paymentMethod: 1, status: 1 });
orderRefundSchema.index({ refundMode: 1, refundMethod: 1 });
orderRefundSchema.index({ refundType: 1, status: 1 });
orderRefundSchema.index({ customerVisible: 1, status: 1 });
orderRefundSchema.index({ "items.lineId": 1 });
orderRefundSchema.index({ "items.productCode": 1 });
orderRefundSchema.index({ "proofs.url": 1 });
orderRefundSchema.index({ "razorpay.refundId": 1 });
orderRefundSchema.index({ "manualRefund.utr": 1 });

export default mongoose.models.OrderRefund ||
  mongoose.model("OrderRefund", orderRefundSchema);