import mongoose from "mongoose";

const inventoryReservationSchema = new mongoose.Schema(
  {
    productModel: {
      type: String,
      enum: ["Product", "Footwear"],
      default: "Product",
      required: true,
      index: true,
    },

    productId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "productModel",
      index: true,
    },

    // null = simple product
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    qty: {
      type: Number,
      required: true,
      min: 1,
    },

    // pending  = waiting for stock
    // reserved = stock already deducted
    // consumed = final usage done
    // released = cancelled / manually released
    // expired  = expired / stale hold
    status: {
      type: String,
      enum: ["pending", "reserved", "released", "consumed", "expired"],
      default: "pending",
      index: true,
    },

    refType: {
      type: String,
      enum: ["order", "production", "manual"],
      required: true,
      index: true,
    },

    refId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    // order:orderId:productId:variantId
    reservationKey: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    productCode: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    productTitle: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    productImage: {
      type: String,
      default: "",
      trim: true,
    },

    orderNumber: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    variantSku: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    selectedSize: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    selectedColor: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    reservedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },

    notes: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

// fast reads
inventoryReservationSchema.index({ productModel: 1, productId: 1, variantId: 1, status: 1, createdAt: 1 });
inventoryReservationSchema.index({ refType: 1, refId: 1, status: 1 });
inventoryReservationSchema.index({ orderNumber: 1, status: 1 });
inventoryReservationSchema.index({ productCode: 1, status: 1 });
inventoryReservationSchema.index({ expiresAt: 1, status: 1 });

// prevent duplicate active reservation per same logical source + same state bucket
inventoryReservationSchema.index(
  { reservationKey: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      reservationKey: { $type: "string", $ne: "" },
      status: { $in: ["pending", "reserved"] },
    },
  }
);

export default mongoose.models.InventoryReservation ||
  mongoose.model("InventoryReservation", inventoryReservationSchema);