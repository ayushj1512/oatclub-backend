import mongoose from "mongoose";

const FabricLogSchema = new mongoose.Schema(
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

    action: {
      type: String,
      required: true,
      enum: [
        "created",
        "updated",
        "status_changed",
        "movement_changed",
        "product_codes_added",
        "product_codes_removed",
        "activated",
        "deactivated",
        "stock_added",
        "stock_subtracted",
        "stock_adjusted",
        "negative_stock_blocked",
      ],
      index: true,
    },

    type: {
      type: String,
      enum: ["add", "subtract", "adjust", "info"],
      default: "info",
      index: true,
    },

    quantity: {
      type: Number,
      min: 0,
      default: 0,
    },

    previousStock: {
      type: Number,
      min: 0,
      default: 0,
    },

    newStock: {
      type: Number,
      min: 0,
      default: 0,
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    note: {
      type: String,
      trim: true,
      default: "",
    },

    message: {
      type: String,
      trim: true,
      default: "",
    },

    logDate: {
      type: Date,
      default: Date.now,
      index: true,
    },

    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    createdBy: {
      type: String,
      trim: true,
      default: "system",
    },
  },
  {
    timestamps: true,
  }
);

FabricLogSchema.pre("validate", function (next) {
  try {
    if (this.previousStock < 0) {
      return next(new Error("previousStock cannot be negative"));
    }

    if (this.newStock < 0) {
      return next(new Error("newStock cannot be negative"));
    }

    if (this.quantity < 0) {
      return next(new Error("quantity cannot be negative"));
    }

    if (!this.description) {
      if (this.type === "add") {
        this.description = `Added ${this.quantity} ${this.unit}`;
      } else if (this.type === "subtract") {
        this.description = `Subtracted ${this.quantity} ${this.unit}`;
      } else if (this.type === "adjust") {
        this.description = `Adjusted stock to ${this.newStock} ${this.unit}`;
      } else {
        this.description = this.action.replaceAll("_", " ");
      }
    }

    if (!this.message) {
      this.message = this.description;
    }

    next();
  } catch (error) {
    next(error);
  }
});

FabricLogSchema.index({ fabricCode: 1, logDate: -1 });
FabricLogSchema.index({ fabric: 1, logDate: -1 });
FabricLogSchema.index({ action: 1, logDate: -1 });
FabricLogSchema.index({ type: 1, logDate: -1 });
FabricLogSchema.index({ createdBy: 1, logDate: -1 });
FabricLogSchema.index({ createdAt: -1 });

export default mongoose.models.FabricLog ||
  mongoose.model("FabricLog", FabricLogSchema);