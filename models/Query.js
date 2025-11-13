import mongoose from "mongoose";

const querySchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null, // For logged-in users
    },

    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    subject: {
      type: String,
      trim: true,
      default: "",
    },

    message: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
    },

    queryType: {
      type: String,
      enum: ["general", "order", "product", "partnership", "support", "other"],
      default: "general",
    },

    source: {
      type: String,
      enum: ["website", "mobile_app", "social_media", "other"],
      default: "website",
    },

    status: {
      type: String,
      enum: ["new", "in_progress", "resolved", "closed"],
      default: "new",
    },

    adminNotes: {
      type: String,
      trim: true,
      default: "",
    },

    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true }
);

// Index for efficient searches
querySchema.index({ email: 1 });
querySchema.index({ status: 1 });
querySchema.index({ queryType: 1 });

export default mongoose.model("Query", querySchema);
