import mongoose from "mongoose";

const creditSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: [true, "Customer ID is required"],
    },

    creditType: {
      type: String,
      enum: ["refund", "promotional", "first_time", "gift_card", "manual_adjustment"],
      required: [true, "Credit type is required"],
    },

    amount: {
      type: Number,
      required: [true, "Credit amount is required"],
      min: [0, "Amount cannot be negative"],
    },

    balanceAfter: {
      type: Number,
      default: 0, // To keep track of wallet total after each transaction
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    sourceRef: {
      type: String,
      trim: true,
      default: "",
      // could store order ID, coupon code, or gift card number
    },

    expiryDate: {
      type: Date,
      default: null, // promotional credits may expire
    },

    status: {
      type: String,
      enum: ["active", "expired", "used"],
      default: "active",
    },

    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null, // track who issued the credit (optional)
    },
  },
  { timestamps: true }
);

// Automatically expire credits when date passes
creditSchema.pre("save", function (next) {
  if (this.expiryDate && this.expiryDate < new Date()) {
    this.status = "expired";
  }
  next();
});

// Indexes for fast querying by customer and type
creditSchema.index({ customerId: 1 });
creditSchema.index({ creditType: 1 });
creditSchema.index({ status: 1 });

export default mongoose.model("Credit", creditSchema);
