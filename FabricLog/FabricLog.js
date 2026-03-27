import mongoose from "mongoose";

const FabricLogSchema = new mongoose.Schema(
  {
    /* -------------------------------
       FABRIC REFERENCE
    -------------------------------- */
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

    /* -------------------------------
       ACTION + ENTRY TYPE
    -------------------------------- */
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
        "deleted",
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

    /* -------------------------------
       STOCK MOVEMENT
    -------------------------------- */
    quantity: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    previousStock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    newStock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    /* -------------------------------
       DESCRIPTION + NOTES
    -------------------------------- */
    description: {
      type: String,
      trim: true,
      required: true,
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

    /* -------------------------------
       CUSTOM LOG DATE
    -------------------------------- */
    logDate: {
      type: Date,
      default: Date.now,
      index: true,
    },

    /* -------------------------------
       FLEXIBLE EXTRA META
    -------------------------------- */
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    /* -------------------------------
       USER TRACKING
    -------------------------------- */
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

/* -------------------------------
   PRE-SAVE SAFETY
-------------------------------- */
FabricLogSchema.pre("validate", function (next) {
  try {
    if (this.newStock < 0) {
      return next(new Error("newStock cannot be negative"));
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

/* -------------------------------
   INDEXES
-------------------------------- */
FabricLogSchema.index({ fabricCode: 1, logDate: -1 });
FabricLogSchema.index({ fabric: 1, logDate: -1 });
FabricLogSchema.index({ action: 1, logDate: -1 });
FabricLogSchema.index({ type: 1, logDate: -1 });
FabricLogSchema.index({ createdAt: -1 });

export default mongoose.models.FabricLog ||
  mongoose.model("FabricLog", FabricLogSchema);