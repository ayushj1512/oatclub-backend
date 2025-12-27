import mongoose from "mongoose";

const FabricSchema = new mongoose.Schema(
  {
    /* -------------------------------
       BASIC IDENTITY
    -------------------------------- */
    name: {
      type: String,
      required: true,
      trim: true,
    },

    code: {
      type: String,
      required: true,
      unique: true,
      index: true, // fast search
    },

    category: {
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
   SAFETY INDEXES
-------------------------------- */
FabricSchema.index({ name: 1, category: 1 });

export default mongoose.models.Fabric ||
  mongoose.model("Fabric", FabricSchema);
