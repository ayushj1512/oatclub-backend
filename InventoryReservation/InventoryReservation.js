// models/InventoryReservation.js
import mongoose from "mongoose";

const inventoryReservationSchema = new mongoose.Schema(
  {
    // =========================
    // Core references
    // =========================
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    // ✅ variable product => required, simple => null
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    qty: { type: Number, required: true, min: 1 },

    status: {
      type: String,
      enum: ["reserved", "released", "consumed", "expired"],
      default: "reserved",
      index: true,
    },

    // =========================
    // Reservation source
    // =========================
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

    // =========================
    // ✅ Denormalized fields (fast reads / reporting)
    // =========================

    // ✅ Always store productCode for search/reporting
    productCode: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    // ✅ NEW: product title/name snapshot
    productTitle: {
      type: String,
      default: "",
      trim: true,
      index: true, // optional but handy for admin search
    },

    // ✅ NEW: keep a single best image for admin tables
    productImage: {
      type: String,
      default: "",
      trim: true,
    },

    // ✅ NEW: Order context (only when refType = "order")
    // Format: MIRAY-000187
    orderNumber: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    // ✅ Optional: variant + quick filters
    variantSku: { type: String, default: "", trim: true, index: true },
    selectedSize: { type: String, default: "", trim: true, index: true },
    selectedColor: { type: String, default: "", trim: true, index: true },

    // =========================
    // Expiry / notes
    // =========================
    expiresAt: { type: Date, default: null, index: true },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

// =========================
// Indexes (fast queries)
// =========================
inventoryReservationSchema.index({ productId: 1, variantId: 1, status: 1 });
inventoryReservationSchema.index({ productCode: 1, status: 1 });
inventoryReservationSchema.index({ refType: 1, refId: 1 });

// ✅ order-based reporting
inventoryReservationSchema.index({ orderNumber: 1, status: 1 });
inventoryReservationSchema.index({ refType: 1, orderNumber: 1 });

// (Optional) admin search combos
inventoryReservationSchema.index({ productTitle: 1, status: 1 });
inventoryReservationSchema.index({ variantSku: 1, status: 1 });

export default mongoose.models.InventoryReservation ||
  mongoose.model("InventoryReservation", inventoryReservationSchema);
