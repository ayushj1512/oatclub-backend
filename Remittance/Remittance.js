// models/Remittance.js
import mongoose from "mongoose";

const remittanceSchema = new mongoose.Schema(
  {
    ewayBillId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    shippingNo: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    orderNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    deliveredDate: {
      type: Date,
      default: null,
      index: true,
    },

    orderType: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    remittanceDate: {
      type: Date,
      default: null,
      index: true,
    },

    remittedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    source: {
      type: String,
      enum: [
        "manual",
        "razorpay",
        "delhivery",
        "shiprocket",
      ],
      default: "manual",
      index: true,
    },

    reportType: {
      type: String,
      default: "",
      trim: true,
    },

    providerReference: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    utr: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    expectedAmount: {
      type: Number,
      default: 0,
    },

    receivedAmount: {
      type: Number,
      default: 0,
    },

    differenceAmount: {
      type: Number,
      default: 0,
    },

    adjustedAmount: {
      type: Number,
      default: 0,
    },

    reconciliationStatus: {
      type: String,
      enum: [
        "pending",
        "fully_remitted",
        "partially_remitted",
        "excess_remitted",
        "amount_adjusted",
        "unmapped",
        "duplicate",
        "needs_review",
        "payment_mode_mismatch",
      ],
      default: "pending",
      index: true,
    },

    isRemitted: {
      type: Boolean,
      default: false,
      index: true,
    },

    requiresReview: {
      type: Boolean,
      default: false,
      index: true,
    },

    matchedOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },

    matchType: {
      type: String,
      enum: [
        "",
        "order_number",
        "shipping_no",
      ],
      default: "",
    },

    importBatchId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    importRowNumber: {
      type: Number,
      default: null,
    },

    rawRow: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// helpful indexes
remittanceSchema.index({ orderNumber: 1 });
remittanceSchema.index({ remittanceDate: 1 });
remittanceSchema.index({ deliveredDate: 1 });
remittanceSchema.index({ shippingNo: 1 });
remittanceSchema.index({ ewayBillId: 1 });

export default mongoose.models.Remittance ||
  mongoose.model("Remittance", remittanceSchema);
