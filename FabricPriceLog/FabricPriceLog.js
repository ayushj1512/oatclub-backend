import mongoose from "mongoose";

const FabricPriceLogSchema = new mongoose.Schema(
  {
    fabric: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Fabric",
      required: true,
      index: true,
    },

    fabricCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    fabricName: {
      type: String,
      required: true,
      trim: true,
    },

    unit: {
      type: String,
      enum: ["meter", "kg"],
      required: true,
    },

    oldPrice: {
      type: Number,
      min: 0,
      default: 0,
      required: true,
    },

    newPrice: {
      type: Number,
      min: 0,
      required: true,
    },

    changeAmount: {
      type: Number,
      default: 0,
    },

    changePercent: {
      type: Number,
      default: 0,
    },

    reason: {
      type: String,
      trim: true,
      default: "",
    },

    note: {
      type: String,
      trim: true,
      default: "",
    },

    effectiveFrom: {
      type: Date,
      default: Date.now,
      index: true,
    },

    createdBy: {
      type: String,
      trim: true,
      default: "system",
    },

    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

FabricPriceLogSchema.pre("validate", function (next) {
  try {
    this.changeAmount = Number(this.newPrice || 0) - Number(this.oldPrice || 0);

    if (this.oldPrice > 0) {
      this.changePercent = Number(
        ((this.changeAmount / this.oldPrice) * 100).toFixed(2)
      );
    } else {
      this.changePercent = this.newPrice > 0 ? 100 : 0;
    }

    next();
  } catch (error) {
    next(error);
  }
});

FabricPriceLogSchema.index({ fabric: 1, effectiveFrom: -1 });
FabricPriceLogSchema.index({ fabricCode: 1, effectiveFrom: -1 });
FabricPriceLogSchema.index({ createdAt: -1 });

export default mongoose.models.FabricPriceLog ||
  mongoose.model("FabricPriceLog", FabricPriceLogSchema);