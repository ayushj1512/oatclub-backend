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