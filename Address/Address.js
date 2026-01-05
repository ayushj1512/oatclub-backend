import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    /**
     * ✅ firebaseUID is OPTIONAL now
     * - Logged-in users: firebaseUID stored
     * - Guest users: firebaseUID = null
     */
    firebaseUID: {
      type: String,
      required: false,
      default: null,
      index: true,
      trim: true,
      sparse: true, // ✅ allows many docs with null firebaseUID
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      index: true,
      lowercase: true,
      trim: true,
    },

    /**
     * ✅ Always required (both guest + logged in)
     * This is your actual relational key
     */
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

/**
 * ✅ Index for fast lookup
 * - Logged-in users: firebaseUID + email
 * - Guest users: firebaseUID = null but email indexed works
 */
addressSchema.index({ firebaseUID: 1, email: 1 });
addressSchema.index({ customerId: 1 });

export default mongoose.models.Address ||
  mongoose.model("Address", addressSchema);
