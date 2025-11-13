// models/Inventory.js
import mongoose from "mongoose";

const inventorySchema = new mongoose.Schema(
  {
    // 🔹 SKU = Stock Keeping Unit — unique per variant/product combination
    sku: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },

    // 🔹 Optional readable ID for warehouse tracking
    inventoryId: {
      type: String,
      unique: true,
      default: function () {
        return "INV-" + Math.random().toString(36).substring(2, 10).toUpperCase();
      },
    },

    // 🔹 Link to the Product
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    // 🔹 Variation info (color, size, material, etc.)
    variant: {
      color: String,
      size: String,
      material: String,
      additionalInfo: String,
    },

    // 🔹 Current stock data
    stock: {
      total: { type: Number, required: true, default: 0 },
      reserved: { type: Number, default: 0 }, // items held in cart/orders
      available: { type: Number, default: 0 }, // computed: total - reserved
    },

    // 🔹 Reorder / alert levels
    threshold: {
      type: Number,
      default: 5,
    },

    // 🔹 Warehouse / storage location
    location: {
      warehouse: { type: String, default: "Main Warehouse" },
      shelf: { type: String },
      section: { type: String },
    },

    // 🔹 Stock movement logs (for analytics)
    movementHistory: [
      {
        action: {
          type: String,
          enum: ["add", "remove", "adjust", "return", "sale"],
        },
        quantity: Number,
        referenceId: String, // could be Order ID, Return ID, etc.
        note: String,
        date: { type: Date, default: Date.now },
      },
    ],

    // 🔹 Supplier / purchase info
    supplier: {
      name: String,
      contact: String,
      batchNumber: String,
      costPrice: Number,
      receivedDate: Date,
    },

    // 🔹 Status flags
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// 🔹 Middleware to auto-update available stock
inventorySchema.pre("save", function (next) {
  this.stock.available = this.stock.total - this.stock.reserved;
  next();
});

export default mongoose.model("Inventory", inventorySchema);
