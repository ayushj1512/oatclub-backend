// models/CustomerTicketModal.js
import mongoose from "mongoose";
import Counter from "../models/Counter.js"; // ✅ as you asked

export const STATUS = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

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

const pad6 = (n) => String(n).padStart(6, "0");
const makeTicketId = (n) => `T-${pad6(n)}`;

const CustomerTicketSchema = new mongoose.Schema(
  {
    // ✅ counter-backed number
    ticketNo: { type: Number, unique: true, index: true },

    // ✅ formatted id
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

/**
 * ✅ EXACTLY like your orderNumber logic
 * - only on new docs
 * - uses Counter { name, seq } with findOneAndUpdate($inc)
 * - produces: T-000001, T-000002...
 */
CustomerTicketSchema.pre("validate", async function (next) {
  try {
    if (!this.isNew) return next();           // only new
    if (this.ticketNo && this.ticketId) return next(); // already set manually

    const counter = await Counter.findOneAndUpdate(
      { name: "customer_ticket" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const no = Number(counter.seq || 0); // first time => 1
    this.ticketNo = no;
    this.ticketId = makeTicketId(no);

    return next();
  } catch (err) {
    return next(err);
  }
});

const CustomerTicketModal =
  mongoose.models.CustomerTicketModal || mongoose.model("CustomerTicketModal", CustomerTicketSchema);

export default CustomerTicketModal;
