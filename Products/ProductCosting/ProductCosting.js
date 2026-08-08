import mongoose from "mongoose";

const productCostingSchema = new mongoose.Schema(
  {
    productCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    fabricCost: {
      type: Number,
      default: 0,
      min: 0,
    },

    trimsCost: {
      type: Number,
      default: 0,
      min: 0,
    },

    cuttingCost: {
      type: Number,
      default: 0,
      min: 0,
    },

    stitchingCost: {
      type: Number,
      default: 0,
      min: 0,
    },

    finishingCost: {
      type: Number,
      default: 0,
      min: 0,
    },

    ironingCost: {
      type: Number,
      default: 0,
      min: 0,
    },

    packagingCost: {
      type: Number,
      default: 0,
      min: 0,
    },

    miscellaneousCost: {
      type: Number,
      default: 0,
      min: 0,
    },

    note: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

/* =========================================================
   TOTAL MANUFACTURING COST
========================================================= */

productCostingSchema.virtual("manufacturingCost").get(function () {
  return (
    Number(this.fabricCost || 0) +
    Number(this.trimsCost || 0) +
    Number(this.cuttingCost || 0) +
    Number(this.stitchingCost || 0) +
    Number(this.finishingCost || 0) +
    Number(this.ironingCost || 0) +
    Number(this.packagingCost || 0) +
    Number(this.miscellaneousCost || 0)
  );
});

productCostingSchema.index({ updatedAt: -1 });
productCostingSchema.index({ createdAt: -1 });

export default mongoose.models.ProductCosting ||
  mongoose.model("ProductCosting", productCostingSchema); 
