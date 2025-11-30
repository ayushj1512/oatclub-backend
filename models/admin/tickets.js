import mongoose from "mongoose";

const ticketSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },

    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "low",
    },

    status: {
      type: String,
      enum: ["open", "in-progress", "resolved", "closed"],
      default: "open",
    },

    // 🔥 createdBy now STRING (no ObjectId needed)
    createdBy: { type: String, required: true },

    // 🔥 assignedTo ALSO STRING
    assignedTo: { type: String, default: null },

    attachments: [
      {
        fileName: String,
        fileUrl: String,
      },
    ],

    category: {
      type: String,
      enum: ["technical", "inventory", "production", "accounting", "other"],
      default: "other",
    },

    dueDate: { type: Date },

    // 🔥 comments also use STRING for commentedBy
    comments: [
      {
        comment: String,
        commentedBy: { type: String, default: null },
        commentedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

const Ticket = mongoose.model("Ticket", ticketSchema);
export default Ticket;
