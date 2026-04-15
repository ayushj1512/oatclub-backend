import mongoose from "mongoose";

/* ------------------------------------------------------------
   IST HELPER
------------------------------------------------------------ */
const toISTDate = (date = new Date()) => {
  return new Date(
    date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
};

const whatsappConfirmationMessageSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      index: true,
      default: null,
    },

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      index: true,
      default: null,
    },

    customerName: {
      type: String,
      trim: true,
      default: "",
    },

    phone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    countryCode: {
      type: String,
      default: "91",
    },

    messageType: {
      type: String,
      enum: ["template", "text", "utility", "marketing", "authentication"],
      default: "template",
      index: true,
    },

    templateName: {
      type: String,
      default: "",
    },

    templateLanguage: {
      type: String,
      default: "en",
    },

    variables: {
      type: [String],
      default: [],
    },

    messageBody: {
      type: String,
      default: "",
    },

    direction: {
      type: String,
      enum: ["outgoing", "incoming"],
      default: "outgoing",
      index: true,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "queued",
        "sent",
        "delivered",
        "read",
        "replied",
        "failed",
      ],
      default: "pending",
      index: true,
    },

    fast2smsRequestId: {
      type: String,
      default: "",
      index: true,
    },

    fast2smsMessageId: {
      type: String,
      default: "",
      index: true,
    },

    /* ---------------- TIME FIELDS (IST SAFE) ---------------- */

    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    repliedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },

    failureReason: {
      type: String,
      default: "",
    },

    customerReplyText: {
      type: String,
      default: "",
    },

    rawSendResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    rawWebhookPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    notes: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

/* ------------------------------------------------------------
   IST GETTERS (READ TIME)
------------------------------------------------------------ */
const istGetter = (value) => {
  if (!value) return value;
  return new Date(
    value.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
};

whatsappConfirmationMessageSchema.path("createdAt").get(istGetter);
whatsappConfirmationMessageSchema.path("updatedAt").get(istGetter);
whatsappConfirmationMessageSchema.path("sentAt").get(istGetter);
whatsappConfirmationMessageSchema.path("deliveredAt").get(istGetter);
whatsappConfirmationMessageSchema.path("readAt").get(istGetter);
whatsappConfirmationMessageSchema.path("repliedAt").get(istGetter);
whatsappConfirmationMessageSchema.path("failedAt").get(istGetter);

/* ------------------------------------------------------------
   AUTO SET IST ON SAVE (OPTIONAL BUT CLEAN)
------------------------------------------------------------ */
whatsappConfirmationMessageSchema.pre("save", function (next) {
  const nowIST = toISTDate();

  if (this.isModified("status")) {
    if (this.status === "sent" && !this.sentAt) this.sentAt = nowIST;
    if (this.status === "delivered" && !this.deliveredAt)
      this.deliveredAt = nowIST;
    if (this.status === "read" && !this.readAt) this.readAt = nowIST;
    if (this.status === "replied" && !this.repliedAt)
      this.repliedAt = nowIST;
    if (this.status === "failed" && !this.failedAt)
      this.failedAt = nowIST;
  }

  next();
});

/* ------------------------------------------------------------ */

const WhatsappConfirmationMessage = mongoose.model(
  "WhatsappConfirmationMessage",
  whatsappConfirmationMessageSchema
);

export default WhatsappConfirmationMessage;