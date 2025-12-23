import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    // 🔑 Preferred Primary Keys for your business logic
    firebaseUID: {
      type: String,
      required: [true, "Firebase UID is required"],
      index: true,
      trim: true,
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      index: true,
      lowercase: true,
      trim: true,
    },

    // (Optional but recommended) Keep customerId for DB relationships
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },

    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
    },

    alternatePhone: {
      type: String,
      trim: true,
      default: "",
    },

    addressLine1: {
      type: String,
      required: [true, "Address line 1 is required"],
      trim: true,
    },

    addressLine2: {
      type: String,
      trim: true,
      default: "",
    },

    landmark: {
      type: String,
      trim: true,
      default: "",
    },

    city: {
      type: String,
      required: [true, "City is required"],
      trim: true,
    },

    state: {
      type: String,
      required: [true, "State is required"],
      trim: true,
    },

    country: {
      type: String,
      required: true,
      trim: true,
      default: "India",
    },

    postalCode: {
      type: String,
      required: [true, "Postal code is required"],
      trim: true,
    },

    addressType: {
      type: String,
      enum: ["home", "office", "billing", "shipping", "other"],
      default: "home",
    },

    isDefaultShipping: {
      type: Boolean,
      default: false,
      index: true,
    },

    isDefaultBilling: {
      type: Boolean,
      default: false,
      index: true,
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },

    coordinates: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

// Index for your primary keys
addressSchema.index({ firebaseUID: 1, email: 1 });

export default mongoose.models.Address ||
  mongoose.model("Address", addressSchema);
