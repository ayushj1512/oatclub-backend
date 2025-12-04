import mongoose from "mongoose";

const STATUS = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

function generateTicketId() {
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `MF-${rand}`;
}

const AttachmentSchema = new mongoose.Schema(
  {
    url: { type: String, trim: true },
    publicId: { type: String, trim: true },
    filename: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    size: { type: Number, min: 0 },
  },
  { _id: false }
);

const CustomerTicketSchema = new mongoose.Schema(
  {
    ticketId: { type: String, unique: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 },
    phone: { type: String, trim: true, maxlength: 20 },
    orderId: { type: String, trim: true, maxlength: 80 },

    issueType: {
      type: String,
      enum: ["Order Issue", "Delivery / Shipment", "Exchange / Return", "Payment / Refund", "Product / Quality", "Other"],
      default: "Order Issue",
    },

    subject: { type: String, required: true, trim: true, maxlength: 180 },
    message: { type: String, required: true, trim: true, maxlength: 5000 },

    attachments: { type: [AttachmentSchema], default: [] },

    status: { type: String, enum: STATUS, default: "OPEN", index: true },

    adminNotes: { type: String, trim: true, maxlength: 5000 },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ✅ Ensure ticketId exists + handle collisions safely
CustomerTicketSchema.pre("validate", async function (next) {
  try {
    if (this.ticketId) return next();

    // Try multiple times (super rare collisions)
    for (let i = 0; i < 10; i++) {
      const id = generateTicketId();
      const exists = await mongoose.models.CustomerTicketModal?.exists({ ticketId: id });
      if (!exists) {
        this.ticketId = id;
        return next();
      }
    }

    return next(new Error("Failed to generate unique ticketId"));
  } catch (err) {
    return next(err);
  }
});

// ✅ Avoid OverwriteModelError in dev / hot reload
const CustomerTicketModal =
  mongoose.models.CustomerTicketModal || mongoose.model("CustomerTicketModal", CustomerTicketSchema);

export default CustomerTicketModal;
export { STATUS };
