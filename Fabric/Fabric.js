import mongoose from "mongoose";
import Counter from "../models/Counter.js";

const FabricSchema = new mongoose.Schema(
  {
    /* -------------------------------
       BASIC IDENTITY
    -------------------------------- */
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    code: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    category: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    unit: {
      type: String,
      enum: ["meter", "kg"],
      required: true,
    },

    /* -------------------------------
       PRICING + IMAGE
    -------------------------------- */
    price: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    imageLink: {
      type: String,
      trim: true,
      default: "",
    },

    /* -------------------------------
       OPTIONAL TECH DETAILS
    -------------------------------- */
    gsm: {
      type: Number,
      min: 1,
      default: null,
    },

    width: {
      type: String,
      trim: true,
      default: null,
    },

    /* -------------------------------
       INVENTORY
    -------------------------------- */
    currentStock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
      index: true,
    },

    lastStockUpdatedAt: {
      type: Date,
      default: null,
    },

    /* -------------------------------
       PRODUCT ASSOCIATION
    -------------------------------- */
    associatedProductCodes: {
      type: [String],
      default: [],
      index: true,
    },

    associatedProductsCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /* -------------------------------
       STATUS & ACTIVITY
    -------------------------------- */
    status: {
      type: String,
      enum: ["active", "inactive", "discontinued"],
      default: "active",
      index: true,
    },

    movementStatus: {
      type: String,
      enum: ["idle", "incoming", "in_use", "outgoing"],
      default: "idle",
      index: true,
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },

    /* -------------------------------
       SAFETY FLAGS
    -------------------------------- */
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

/* -------------------------------
   HELPERS
-------------------------------- */
function normalizeProductCodes(arr = []) {
  return [...new Set(arr.map((v) => String(v || "").trim()).filter(Boolean))];
}

/* -------------------------------
   AUTO FABRIC CODE
   F00001, F00002 ...
-------------------------------- */
FabricSchema.pre("validate", async function (next) {
  try {
    if (!this.code) {
      const counter = await Counter.findOneAndUpdate(
        { name: "fabric" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      this.code = `F${String(counter.seq).padStart(5, "0")}`;
    }

    next();
  } catch (error) {
    next(error);
  }
});

/* -------------------------------
   CLEAN PRODUCT CODES + COUNT
-------------------------------- */
FabricSchema.pre("save", function (next) {
  try {
    this.associatedProductCodes = normalizeProductCodes(
      this.associatedProductCodes
    );
    this.associatedProductsCount = this.associatedProductCodes.length;

    if (this.currentStock < 0) {
      return next(new Error("Current stock cannot be negative"));
    }

    next();
  } catch (error) {
    next(error);
  }
});

/* -------------------------------
   UPDATE HOOKS
-------------------------------- */
function syncFabricUpdate(next) {
  try {
    const update = this.getUpdate() || {};

    if (update.associatedProductCodes) {
      update.associatedProductCodes = normalizeProductCodes(
        update.associatedProductCodes
      );
      update.associatedProductsCount = update.associatedProductCodes.length;
    }

    if (update.$set?.associatedProductCodes) {
      update.$set.associatedProductCodes = normalizeProductCodes(
        update.$set.associatedProductCodes
      );
      update.$set.associatedProductsCount =
        update.$set.associatedProductCodes.length;
    }

    if (typeof update.currentStock === "number" && update.currentStock < 0) {
      return next(new Error("Current stock cannot be negative"));
    }

    if (
      typeof update.$set?.currentStock === "number" &&
      update.$set.currentStock < 0
    ) {
      return next(new Error("Current stock cannot be negative"));
    }

    this.setUpdate(update);
    next();
  } catch (error) {
    next(error);
  }
}

FabricSchema.pre("findOneAndUpdate", syncFabricUpdate);
FabricSchema.pre("updateOne", syncFabricUpdate);
FabricSchema.pre("updateMany", syncFabricUpdate);

/* -------------------------------
   INDEXES
-------------------------------- */
FabricSchema.index({ name: 1, category: 1 });
FabricSchema.index({ code: 1 }, { unique: true });
FabricSchema.index({ associatedProductCodes: 1 });
FabricSchema.index({ isActive: 1, status: 1 });
FabricSchema.index({ currentStock: 1 });

export default mongoose.models.Fabric ||
  mongoose.model("Fabric", FabricSchema);