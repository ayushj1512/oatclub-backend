// customerTicket.controller.js
import CustomerTicketModal from "./CustomerTicketModal.js";
import { uploadToCloudinary, cloudinary } from "../config/cloudinary.js"; // ✅ cloudinary optional (see notes)

export const STATUS = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
export const ISSUE_TYPES = [
  "Order Issue",
  "Delivery / Shipment",
  "Exchange / Return",
  "Payment / Refund",
  "Product / Quality",
  "Other",
];

/* ---------------- helpers ---------------- */
const s = (v) => String(v ?? "").trim();
const lower = (v) => s(v).toLowerCase();
const upper = (v) => s(v).toUpperCase();
const escRe = (x) => String(x || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const mapAttachment = (a) => ({
  url: a?.url || "",
  publicId: a?.publicId || "",
  filename: a?.filename || "",
  mimeType: a?.mimeType || "",
  size: Number(a?.size || 0),
});

const mapTicket = (t) => ({
  ticketId: t.ticketId,
  status: t.status,
  name: t.name,
  email: t.email,
  phone: t.phone,
  orderId: t.orderId,
  issueType: t.issueType,
  subject: t.subject,
  message: t.message,
  adminNotes: t.adminNotes || "",
  attachments: (t.attachments || []).map(mapAttachment),
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  resolvedAt: t.resolvedAt || null,
});

/* ===================================================================
   USER: Create ticket (multipart/form-data)
   POST /api/support/tickets   (upload.array("files", 5))
=================================================================== */
export const createTicket = async (req, res) => {
  try {
    const name = s(req.body?.name);
    const email = lower(req.body?.email);
    const phone = s(req.body?.phone);
    const orderId = s(req.body?.orderId);
    const subject = s(req.body?.subject);
    const issueType = s(req.body?.issueType) || "Order Issue";
    const message = s(req.body?.message);

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ success: false, message: "name, email, subject, message are required." });
    }
    if (issueType && !ISSUE_TYPES.includes(issueType)) {
      return res.status(400).json({ success: false, message: "Invalid issueType." });
    }

    const files = Array.isArray(req.files) ? req.files.slice(0, 5) : [];
    let attachments = [];

    if (files.length) {
      const folder = "miray/support-tickets";
      const uploads = await Promise.all(
        files.map(async (file) => {
          const r = await uploadToCloudinary(file, folder, "image");
          return {
            url: s(r?.secure_url),
            publicId: s(r?.public_id),
            filename: s(file?.originalname),
            mimeType: s(file?.mimetype),
            size: Number(file?.size || 0),
          };
        })
      );
      attachments = uploads.filter((u) => u?.url);
    }

    const ticket = await CustomerTicketModal.create({
      name,
      email,
      phone,
      orderId,
      subject,
      issueType,
      message,
      attachments,
      status: "OPEN",
    });

    return res.status(201).json({
      success: true,
      message: "Ticket created successfully.",
      ticketId: ticket.ticketId,
      ticket: {
        ticketId: ticket.ticketId,
        status: ticket.status,
        createdAt: ticket.createdAt,
        attachments: (ticket.attachments || []).map((a) => ({ url: a.url, filename: a.filename })),
      },
    });
  } catch (err) {
    console.error("createTicket error:", err);
    if (err?.code === 11000) return res.status(409).json({ success: false, message: "Duplicate ticketId, try again." });
    return res.status(500).json({ success: false, message: err?.message || "Server error creating ticket." });
  }
};

/* ===================================================================
   GET single ticket
   GET /api/support/tickets/:ticketId
=================================================================== */
export const getTicketByTicketId = async (req, res) => {
  try {
    const ticketId = s(req.params?.ticketId);
    if (!ticketId) return res.status(400).json({ success: false, message: "ticketId is required." });

    const ticket = await CustomerTicketModal.findOne({ ticketId }).lean();
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found." });

    return res.json({ success: true, ticket: mapTicket(ticket) });
  } catch (err) {
    console.error("getTicketByTicketId error:", err);
    return res.status(500).json({ success: false, message: "Server error fetching ticket." });
  }
};

/* ===================================================================
   UPDATE status + adminNotes
   PATCH /api/support/tickets/:ticketId/status
   Body: { status, adminNotes }
=================================================================== */
export const updateTicketStatus = async (req, res) => {
  try {
    const ticketId = s(req.params?.ticketId);
    const status = upper(req.body?.status);
    const adminNotes = s(req.body?.adminNotes);

    if (!ticketId) return res.status(400).json({ success: false, message: "ticketId is required." });
    if (!STATUS.includes(status)) return res.status(400).json({ success: false, message: "Invalid status." });

    const update = { status, resolvedAt: status === "RESOLVED" ? new Date() : null };
    if (adminNotes !== "") update.adminNotes = adminNotes;

    const ticket = await CustomerTicketModal.findOneAndUpdate({ ticketId }, update, { new: true }).lean();
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found." });

    return res.json({
      success: true,
      message: "Ticket updated.",
      ticket: {
        ticketId: ticket.ticketId,
        status: ticket.status,
        adminNotes: ticket.adminNotes || "",
        resolvedAt: ticket.resolvedAt || null,
        updatedAt: ticket.updatedAt,
      },
    });
  } catch (err) {
    console.error("updateTicketStatus error:", err);
    return res.status(500).json({ success: false, message: "Server error updating ticket." });
  }
};

/* ===================================================================
   GET tickets by email (exact)
   GET /api/support/tickets/by-email?email=..&status=OPEN&page=1&limit=10
=================================================================== */
export const getTicketsByEmail = async (req, res) => {
  try {
    const email = lower(req.query?.email);
    const status = upper(req.query?.status);
    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 10)));
    const skip = (page - 1) * limit;

    if (!email) return res.status(400).json({ success: false, message: "email is required in query (?email=...)." });

    const filter = { email };
    if (status) {
      if (!STATUS.includes(status)) return res.status(400).json({ success: false, message: "Invalid status filter." });
      filter.status = status;
    }

    const [items, total] = await Promise.all([
      CustomerTicketModal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CustomerTicketModal.countDocuments(filter),
    ]);

    return res.json({ success: true, mode: "by-email", email, page, limit, total, tickets: items.map(mapTicket) });
  } catch (err) {
    console.error("getTicketsByEmail error:", err);
    return res.status(500).json({ success: false, message: "Server error fetching tickets by email." });
  }
};

/* ===================================================================
   ADMIN list (filters + pagination)
   GET /api/support/tickets?status=OPEN&issueType=Order%20Issue&q=damage&page=1&limit=15
=================================================================== */
export const getTicketsAdminList = async (req, res) => {
  try {
    const status = upper(req.query?.status);
    const issueType = s(req.query?.issueType);
    const q = s(req.query?.q);
    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 15)));
    const skip = (page - 1) * limit;

    const filter = {};

    if (status) {
      if (!STATUS.includes(status)) return res.status(400).json({ success: false, message: "Invalid status filter." });
      filter.status = status;
    }

    if (issueType && issueType !== "All") {
      if (![...ISSUE_TYPES, "All"].includes(issueType))
        return res.status(400).json({ success: false, message: "Invalid issueType." });
      filter.issueType = issueType;
    }

    if (q) {
      const re = new RegExp(escRe(q), "i");
      filter.$or = [
        { ticketId: re },
        { name: re },
        { email: re },
        { phone: re },
        { orderId: re },
        { subject: re },
        { message: re },
      ];
    }

    const [items, total] = await Promise.all([
      CustomerTicketModal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CustomerTicketModal.countDocuments(filter),
    ]);

    return res.json({ success: true, mode: "admin", page, limit, total, tickets: items.map(mapTicket) });
  } catch (err) {
    console.error("getTicketsAdminList error:", err);
    return res.status(500).json({ success: false, message: "Server error fetching tickets." });
  }
};

/* ===================================================================
   ADMIN partial search
   GET /api/support/tickets/search?q=ayushjuneja&status=OPEN&page=1&limit=50
=================================================================== */
export const searchTickets = async (req, res) => {
  try {
    const q = s(req.query?.q);
    const status = upper(req.query?.status);
    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 50)));
    const skip = (page - 1) * limit;

    if (!q) return res.status(400).json({ success: false, message: "q is required (?q=...)." });

    const filter = {};
    if (status) {
      if (!STATUS.includes(status)) return res.status(400).json({ success: false, message: "Invalid status filter." });
      filter.status = status;
    }

    const re = new RegExp(escRe(q), "i");
    filter.$or = [
      { ticketId: re },
      { name: re },
      { email: re },
      { phone: re },
      { orderId: re },
      { subject: re },
      { message: re },
    ];

    const [items, total] = await Promise.all([
      CustomerTicketModal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CustomerTicketModal.countDocuments(filter),
    ]);

    return res.json({ success: true, mode: "search", q, page, limit, total, tickets: items.map(mapTicket) });
  } catch (err) {
    console.error("searchTickets error:", err);
    return res.status(500).json({ success: false, message: "Server error searching tickets." });
  }
};

/* ===================================================================
   ✅ DELETE ticket (and optionally delete cloudinary attachments)
   DELETE /api/support/tickets/:ticketId
=================================================================== */
export const deleteTicket = async (req, res) => {
  try {
    const ticketId = s(req.params?.ticketId);
    if (!ticketId) return res.status(400).json({ success: false, message: "ticketId is required." });

    const ticket = await CustomerTicketModal.findOne({ ticketId }).lean();
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found." });

    // ✅ best effort: delete attachments from Cloudinary (won't fail delete if cloudinary not wired)
    const publicIds = (ticket.attachments || []).map((a) => s(a?.publicId)).filter(Boolean);

    if (publicIds.length && cloudinary?.uploader?.destroy) {
      await Promise.allSettled(publicIds.map((pid) => cloudinary.uploader.destroy(pid)));
    }

    await CustomerTicketModal.deleteOne({ ticketId });

    return res.json({ success: true, message: "Ticket deleted.", ticketId });
  } catch (err) {
    console.error("deleteTicket error:", err);
    return res.status(500).json({ success: false, message: err?.message || "Server error deleting ticket." });
  }
};
