import mongoose from "mongoose";

const cuttingBatchSchema = new mongoose.Schema(
  {
    batchNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    source: {
      type: String,
      enum: ["shopify", "website"],
      default: "website",
      index: true,
    },

    fromOrderNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    toOrderNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    totalOrders: {
      type: Number,
      default: 0,
    },

    totalPieces: {
      type: Number,
      default: 0,
    },

    rows: [
      {
        productTitle: String,
        productCode: String,
        productImage: String,

        xs: { type: Number, default: 0 },
        s: { type: Number, default: 0 },
        m: { type: Number, default: 0 },
        l: { type: Number, default: 0 },
        xl: { type: Number, default: 0 },

        totalQty: { type: Number, default: 0 },
      },
    ],

    logs: [
      {
        action: String,
        message: String,
        at: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true }
);

cuttingBatchSchema.index({ createdAt: -1 });
cuttingBatchSchema.index({ source: 1, createdAt: -1 });

export default mongoose.models.CuttingBatch ||
  mongoose.model("CuttingBatch", cuttingBatchSchema);