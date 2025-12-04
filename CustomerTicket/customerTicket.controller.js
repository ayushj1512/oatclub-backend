import CustomerTicketModal from "./CustomerTicketModal.js";
import { uploadToCloudinary } from "../config/cloudinary.js";

export const STATUS = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
export const ISSUE_TYPES = ["Order Issue", "Delivery / Shipment", "Exchange / Return", "Payment / Refund", "Product / Quality", "Other"];

const safeStr = (v) => String(v ?? "").trim();
const safeLower = (v) => safeStr(v).toLowerCase();
const safeUpper = (v) => safeStr(v).toUpperCase();
const escapeRegex = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

/**
 * USER: Create ticket (multipart/form-data)
 * POST /api/support/tickets
 * expects upload.array("files", 5)
 */
export const createTicket = async (req, res) => {
  try {
    const name = safeStr(req.body?.name);
    const email = safeLower(req.body?.email);
    const phone = safeStr(req.body?.phone);
    const orderId = safeStr(req.body?.orderId);
    const subject = safeStr(req.body?.subject);
    const issueType = safeStr(req.body?.issueType) || "Order Issue";
    const message = safeStr(req.body?.message);

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ success: false, message: "name, email, subject, message are required." });
    }
    if (issueType && !ISSUE_TYPES.includes(issueType)) {
      return res.status(400).json({ success: false, message: "Invalid issueType." });
    }

    // ✅ multer => req.files buffers, max 5
    const files = Array.isArray(req.files) ? req.files.slice(0, 5) : [];
    let attachments = [];

    if (files.length) {
      const folder = "miray/support-tickets";
      const uploads = await Promise.all(
        files.map(async (file) => {
          const result = await uploadToCloudinary(file, folder, "image");
          return {
            url: safeStr(result?.secure_url),
            publicId: safeStr(result?.public_id),
            filename: safeStr(file?.originalname),
            mimeType: safeStr(file?.mimetype),
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

/**
 * USER/SUPPORT/ADMIN: Get a single ticket by ticketId
 * GET /api/support/tickets/:ticketId
 */
export const getTicketByTicketId = async (req, res) => {
  try {
    const ticketId = safeStr(req.params?.ticketId);
    if (!ticketId) return res.status(400).json({ success: false, message: "ticketId is required." });

    const ticket = await CustomerTicketModal.findOne({ ticketId }).lean();
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found." });

    return res.json({ success: true, ticket: mapTicket(ticket) });
  } catch (err) {
    console.error("getTicketByTicketId error:", err);
    return res.status(500).json({ success: false, message: "Server error fetching ticket." });
  }
};

/**
 * SUPPORT/ADMIN: Update ticket status + adminNotes
 * PATCH /api/support/tickets/:ticketId/status
 * Body: { status, adminNotes }
 */
export const updateTicketStatus = async (req, res) => {
  try {
    const ticketId = safeStr(req.params?.ticketId);
    const status = safeUpper(req.body?.status);
    const adminNotes = safeStr(req.body?.adminNotes);

    if (!ticketId) return res.status(400).json({ success: false, message: "ticketId is required." });
    if (!STATUS.includes(status)) return res.status(400).json({ success: false, message: "Invalid status." });

    const update = { status };
    if (adminNotes !== "") update.adminNotes = adminNotes;

    update.resolvedAt = status === "RESOLVED" ? new Date() : null;

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

/**
 * USER: Get tickets by email (exact email)
 * GET /api/support/tickets/by-email?email=..&status=OPEN&page=1&limit=10
 */
export const getTicketsByEmail = async (req, res) => {
  try {
    const email = safeLower(req.query?.email);
    const status = safeUpper(req.query?.status); // optional
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

/**
 * ADMIN/SUPPORT DASHBOARD: List ALL tickets with filters + pagination
 * GET /api/support/tickets?status=OPEN&issueType=Order%20Issue&q=damage&page=1&limit=15
 */
export const getTicketsAdminList = async (req, res) => {
  try {
    const status = safeUpper(req.query?.status);
    const issueType = safeStr(req.query?.issueType);
    const q = safeStr(req.query?.q);
    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 15)));
    const skip = (page - 1) * limit;

    const filter = {};

    if (status) {
      if (!STATUS.includes(status)) return res.status(400).json({ success: false, message: "Invalid status filter." });
      filter.status = status;
    }

    if (issueType && issueType !== "All") {
      if (![...ISSUE_TYPES, "All"].includes(issueType)) return res.status(400).json({ success: false, message: "Invalid issueType." });
      filter.issueType = issueType;
    }

    if (q) {
      const re = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ ticketId: re }, { name: re }, { email: re }, { phone: re }, { orderId: re }, { subject: re }, { message: re }];
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

/**
 * ✅ ADMIN/SUPPORT SEARCH (partial query)
 * GET /api/support/tickets/search?q=ayushjuneja
 * Works for: name/email/ticketId/subject/message/orderId/phone (partial match)
 */
export const searchTickets = async (req, res) => {
  try {
    const q = safeStr(req.query?.q);
    const status = safeUpper(req.query?.status);
    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 50)));
    const skip = (page - 1) * limit;

    if (!q) return res.status(400).json({ success: false, message: "q is required (?q=...)." });

    const filter = {};
    if (status) {
      if (!STATUS.includes(status)) return res.status(400).json({ success: false, message: "Invalid status filter." });
      filter.status = status;
    }

    const re = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ ticketId: re }, { name: re }, { email: re }, { phone: re }, { orderId: re }, { subject: re }, { message: re }];

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
