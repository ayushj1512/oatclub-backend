import mongoose from "mongoose";
import Counter from "../models/Counter.js";

const DEFAULT_LOW_STOCK_THRESHOLD = 20;

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
       IMAGE
    -------------------------------- */
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

    lowStockThreshold: {
      type: Number,
      min: 0,
      default: DEFAULT_LOW_STOCK_THRESHOLD,
      index: true,
    },

    isLowStock: {
      type: Boolean,
      default: false,
      index: true,
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
  return [
    ...new Set(
      arr.map((value) => String(value || "").trim()).filter(Boolean)
    ),
  ];
}

function getLowStockState(currentStock, lowStockThreshold) {
  const stock = Number(currentStock || 0);
  const threshold = Number(
    lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD
  );

  return stock <= threshold;
}

/* -------------------------------
   AUTO FABRIC CODE + LOW STOCK
-------------------------------- */
FabricSchema.pre("validate", async function (next) {
  try {
    if (!this.code) {
      const counter = await Counter.findOneAndUpdate(
        { name: "fabric" },
        { $inc: { seq: 1 } },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
        }
      );

      this.code = `F${String(counter.seq).padStart(5, "0")}`;
    }

    this.lowStockThreshold =
      Number(this.lowStockThreshold) >= 0
        ? Number(this.lowStockThreshold)
        : DEFAULT_LOW_STOCK_THRESHOLD;

    this.isLowStock = getLowStockState(
      this.currentStock,
      this.lowStockThreshold
    );

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

    this.associatedProductsCount =
      this.associatedProductCodes.length;

    if (this.currentStock < 0) {
      return next(
        new Error("Current stock cannot be negative")
      );
    }

    if (this.lowStockThreshold < 0) {
      return next(
        new Error("Low stock threshold cannot be negative")
      );
    }

    this.isLowStock = getLowStockState(
      this.currentStock,
      this.lowStockThreshold
    );

    next();
  } catch (error) {
    next(error);
  }
});

/* -------------------------------
   UPDATE HOOKS
-------------------------------- */
async function syncFabricUpdate(next) {
  try {
    const update = this.getUpdate() || {};

    delete update.price;

    if (update.$set?.price !== undefined) {
      delete update.$set.price;
    }

    if (update.associatedProductCodes) {
      update.associatedProductCodes = normalizeProductCodes(
        update.associatedProductCodes
      );

      update.associatedProductsCount =
        update.associatedProductCodes.length;
    }

    if (update.$set?.associatedProductCodes) {
      update.$set.associatedProductCodes =
        normalizeProductCodes(
          update.$set.associatedProductCodes
        );

      update.$set.associatedProductsCount =
        update.$set.associatedProductCodes.length;
    }

    const existingFabric = await this.model
      .findOne(this.getQuery())
      .select("currentStock lowStockThreshold");

    if (!existingFabric) {
      this.setUpdate(update);
      return next();
    }

    let nextStock = Number(existingFabric.currentStock || 0);

    if (update.currentStock !== undefined) {
      nextStock = Number(update.currentStock);
    }

    if (update.$set?.currentStock !== undefined) {
      nextStock = Number(update.$set.currentStock);
    }

    if (update.$inc?.currentStock !== undefined) {
      nextStock += Number(update.$inc.currentStock);
    }

    let nextThreshold = Number(
      existingFabric.lowStockThreshold ??
        DEFAULT_LOW_STOCK_THRESHOLD
    );

    if (update.lowStockThreshold !== undefined) {
      nextThreshold = Number(update.lowStockThreshold);
    }

    if (update.$set?.lowStockThreshold !== undefined) {
      nextThreshold = Number(
        update.$set.lowStockThreshold
      );
    }

    if (nextStock < 0) {
      return next(
        new Error("Current stock cannot be negative")
      );
    }

    if (nextThreshold < 0) {
      return next(
        new Error("Low stock threshold cannot be negative")
      );
    }

    update.$set = {
      ...(update.$set || {}),
      isLowStock: getLowStockState(
        nextStock,
        nextThreshold
      ),
    };

    const stockUpdated =
      update.currentStock !== undefined ||
      update.$set?.currentStock !== undefined ||
      update.$inc?.currentStock !== undefined;

    if (stockUpdated) {
      update.$set.lastStockUpdatedAt = new Date();
    }

    this.setUpdate(update);
    next();
  } catch (error) {
    next(error);
  }
}

FabricSchema.pre("findOneAndUpdate", syncFabricUpdate);
FabricSchema.pre("updateOne", syncFabricUpdate);

/* -------------------------------
   INDEXES
-------------------------------- */
FabricSchema.index({ name: 1, category: 1 });
FabricSchema.index({ code: 1 }, { unique: true });
FabricSchema.index({ associatedProductCodes: 1 });
FabricSchema.index({ isActive: 1, status: 1 });
FabricSchema.index({ currentStock: 1 });
FabricSchema.index({ isLowStock: 1, lowStockThreshold: 1 });

export default mongoose.models.Fabric ||
  mongoose.model("Fabric", FabricSchema);