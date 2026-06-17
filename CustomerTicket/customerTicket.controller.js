// customerTicket.controller.js
import CustomerTicketModal from "./CustomerTicketModal.js";
import { uploadToCloudinary, cloudinary } from "../config/cloudinary.js";

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
  ticketNo: t.ticketNo || null,
  status: t.status,
  name: t.name,
  email: t.email,
  phone: t.phone,
  orderNumber: t.orderNumber || "",
  issueType: t.issueType,
  subject: t.subject,
  message: t.message,
  adminNotes: t.adminNotes || "",
  attachments: (t.attachments || []).map(mapAttachment),
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  resolvedAt: t.resolvedAt || null,
});

const pickFiles = (req) => {
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === "object") {
    return Object.values(req.files).flat().filter(Boolean);
  }
  return req.file ? [req.file] : [];
};

const toInt = (v, d) => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

/* ===================================================================
   USER: Create ticket (multipart/form-data)
   POST /api/support/tickets   (upload.array("files", 5))
=================================================================== */
export const createTicket = async (req, res) => {
  try {
    const name = s(req.body?.name);
    const email = lower(req.body?.email);
    const phone = s(req.body?.phone);

    // ✅ OPTIONAL orderNumber (store "" if not provided)
    const orderNumberRaw = s(req.body?.orderNumber);
    const orderNumber = orderNumberRaw ? upper(orderNumberRaw) : "";

    const subject = s(req.body?.subject);
    const issueType = s(req.body?.issueType) || "Order Issue";
    const message = s(req.body?.message);

    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: "name, email, subject, message are required.",
      });
    }
    if (issueType && !ISSUE_TYPES.includes(issueType)) {
      return res.status(400).json({ success: false, message: "Invalid issueType." });
    }

    const files = pickFiles(req).slice(0, 5);
    let attachments = [];

    if (files.length) {
      const folder = "oatclub/support-tickets";
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
      orderNumber, // ✅ "" if not provided
      subject,
      issueType,
      message,
      attachments,
      status: "OPEN",
    });

    return res.status(201).json({
      success: true,
      message: "Ticket created successfully.",
      ticket: {
        ticketId: ticket.ticketId,
        ticketNo: ticket.ticketNo || null,
        orderNumber: ticket.orderNumber || "",
        status: ticket.status,
        createdAt: ticket.createdAt,
        attachments: (ticket.attachments || []).map((a) => ({
          url: a.url,
          filename: a.filename,
        })),
      },
    });
  } catch (err) {
    console.error("createTicket error:", err);
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate ticketId/ticketNo, try again.",
      });
    }
    return res.status(500).json({
      success: false,
      message: err?.message || "Server error creating ticket.",
    });
  }
};

/* ===================================================================
   GET single ticket
   GET /api/support/tickets/:ticketId
=================================================================== */
export const getTicketByTicketId = async (req, res) => {
  try {
    const ticketId = s(req.params?.ticketId);
    if (!ticketId) {
      return res.status(400).json({ success: false, message: "ticketId is required." });
    }

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

    const update = {
      status,
      resolvedAt: status === "RESOLVED" || status === "CLOSED" ? new Date() : null,
    };
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
   ✅ PATCH: edit ticket details (admin / internal)
   PATCH /api/support/tickets/:ticketId
=================================================================== */
export const patchTicketDetails = async (req, res) => {
  try {
    const ticketId = s(req.params?.ticketId);
    if (!ticketId) return res.status(400).json({ success: false, message: "ticketId is required." });

    const b = req.body || {};
    const update = {};

    if (b.name !== undefined) update.name = s(b.name);
    if (b.email !== undefined) update.email = lower(b.email);
    if (b.phone !== undefined) update.phone = s(b.phone);
    if (b.orderNumber !== undefined) update.orderNumber = upper(b.orderNumber);
    if (b.subject !== undefined) update.subject = s(b.subject);
    if (b.message !== undefined) update.message = s(b.message);
    if (b.adminNotes !== undefined) update.adminNotes = s(b.adminNotes);

    if (b.issueType !== undefined) {
      const it = s(b.issueType);
      if (it && !ISSUE_TYPES.includes(it)) {
        return res.status(400).json({ success: false, message: "Invalid issueType." });
      }
      update.issueType = it;
    }

    if (b.status !== undefined) {
      const st = upper(b.status);
      if (!STATUS.includes(st)) return res.status(400).json({ success: false, message: "Invalid status." });
      update.status = st;
      update.resolvedAt = st === "RESOLVED" || st === "CLOSED" ? new Date() : null;
    }

    const files = pickFiles(req).slice(0, 5);
    if (files.length) {
      const folder = "oatclub/support-tickets";
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
      const added = uploads.filter((u) => u?.url);
      if (added.length) update.$push = { attachments: { $each: added } };
    }

    const hasAny =
      Object.keys(update).length > 0 ||
      (update.$push && update.$push.attachments && update.$push.attachments.$each?.length);

    if (!hasAny) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided to update.",
      });
    }

    const ticket = await CustomerTicketModal.findOneAndUpdate({ ticketId }, update, {
      new: true,
      runValidators: true,
    }).lean();

    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found." });

    return res.json({
      success: true,
      message: "Ticket details updated.",
      ticket: mapTicket(ticket),
    });
  } catch (err) {
    console.error("patchTicketDetails error:", err);
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: "Duplicate value (unique field conflict)." });
    }
    return res.status(500).json({
      success: false,
      message: err?.message || "Server error updating ticket details.",
    });
  }
};

/* ===================================================================
   ✅ UPDATE orderNumber (admin)
   PATCH /api/support/tickets/:ticketId/order
=================================================================== */
export const updateTicketOrderNumber = async (req, res) => {
  try {
    const ticketId = s(req.params?.ticketId);
    const orderNumber = upper(req.body?.orderNumber);

    if (!ticketId) return res.status(400).json({ success: false, message: "ticketId is required." });
    if (!orderNumber) return res.status(400).json({ success: false, message: "orderNumber is required." });

    const ticket = await CustomerTicketModal.findOneAndUpdate({ ticketId }, { orderNumber }, { new: true }).lean();
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found." });

    return res.json({
      success: true,
      message: "Order number updated.",
      ticket: {
        ticketId: ticket.ticketId,
        orderNumber: ticket.orderNumber || "",
        updatedAt: ticket.updatedAt,
      },
    });
  } catch (err) {
    console.error("updateTicketOrderNumber error:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Server error updating order number.",
    });
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

    const page = toInt(req.query?.page, 1);
    const limit = Math.min(50, toInt(req.query?.limit, 10));
    const skip = (page - 1) * limit;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "email is required in query (?email=...).",
      });
    }

    const filter = { email };
    if (status) {
      if (!STATUS.includes(status)) return res.status(400).json({ success: false, message: "Invalid status filter." });
      filter.status = status;
    }

    const [items, total] = await Promise.all([
      CustomerTicketModal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CustomerTicketModal.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      mode: "by-email",
      email,
      page,
      limit,
      total,
      tickets: items.map(mapTicket),
    });
  } catch (err) {
    console.error("getTicketsByEmail error:", err);
    return res.status(500).json({ success: false, message: "Server error fetching tickets by email." });
  }
};

/* ===================================================================
   ✅ GET tickets by orderNumber (exact)
=================================================================== */
export const getTicketsByOrderNumber = async (req, res) => {
  try {
    const orderNumber = upper(req.query?.orderNumber);
    const status = upper(req.query?.status);

    const page = toInt(req.query?.page, 1);
    const limit = Math.min(50, toInt(req.query?.limit, 10));
    const skip = (page - 1) * limit;

    if (!orderNumber) {
      return res.status(400).json({
        success: false,
        message: "orderNumber is required in query (?orderNumber=...).",
      });
    }

    const filter = { orderNumber };
    if (status) {
      if (!STATUS.includes(status)) return res.status(400).json({ success: false, message: "Invalid status filter." });
      filter.status = status;
    }

    const [items, total] = await Promise.all([
      CustomerTicketModal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CustomerTicketModal.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      mode: "by-order",
      orderNumber,
      page,
      limit,
      total,
      tickets: items.map(mapTicket),
    });
  } catch (err) {
    console.error("getTicketsByOrderNumber error:", err);
    return res.status(500).json({ success: false, message: "Server error fetching tickets by order number." });
  }
};

/* ===================================================================
   ADMIN list (filters + pagination)
=================================================================== */
export const getTicketsAdminList = async (req, res) => {
  try {
    const status = upper(req.query?.status);
    const issueType = s(req.query?.issueType);
    const q = s(req.query?.q);
    const orderNumber = upper(req.query?.orderNumber);

    const page = toInt(req.query?.page, 1);
    const limit = Math.min(50, toInt(req.query?.limit, 15));
    const skip = (page - 1) * limit;

    const filter = {};

    if (status) {
      if (!STATUS.includes(status)) return res.status(400).json({ success: false, message: "Invalid status filter." });
      filter.status = status;
    }

    if (issueType && issueType !== "All") {
      if (![...ISSUE_TYPES, "All"].includes(issueType)) {
        return res.status(400).json({ success: false, message: "Invalid issueType." });
      }
      filter.issueType = issueType;
    }

    if (orderNumber) filter.orderNumber = orderNumber;

    if (q) {
      const re = new RegExp(escRe(q), "i");
      filter.$or = [
        { ticketId: re },
        { name: re },
        { email: re },
        { phone: re },
        { orderNumber: re },
        { subject: re },
        { message: re },
      ];
    }

    const [items, total] = await Promise.all([
      CustomerTicketModal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CustomerTicketModal.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      mode: "admin",
      page,
      limit,
      total,
      tickets: items.map(mapTicket),
    });
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

    const page = toInt(req.query?.page, 1);
    const limit = Math.min(50, toInt(req.query?.limit, 50));
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
      { orderNumber: re },
      { subject: re },
      { message: re },
    ];

    const [items, total] = await Promise.all([
      CustomerTicketModal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CustomerTicketModal.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      mode: "search",
      q,
      page,
      limit,
      total,
      tickets: items.map(mapTicket),
    });
  } catch (err) {
    console.error("searchTickets error:", err);
    return res.status(500).json({ success: false, message: "Server error searching tickets." });
  }
};

/* ===================================================================
   ✅ DELETE ticket (single) + best-effort Cloudinary cleanup
   DELETE /api/support/tickets/:ticketId
=================================================================== */
export const deleteTicket = async (req, res) => {
  try {
    const ticketId = s(req.params?.ticketId);
    if (!ticketId) return res.status(400).json({ success: false, message: "ticketId is required." });

    const ticket = await CustomerTicketModal.findOne({ ticketId }).lean();
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found." });

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

/* ===================================================================
   ✅ BULK DELETE (admin)
   DELETE /api/support/tickets/bulk-delete
   Body: { ticketIds: ["TICKET-1", "TICKET-2"] }
   - Deletes tickets + best-effort deletes cloudinary attachments
=================================================================== */
export const bulkDeleteTickets = async (req, res) => {
  try {
    const idsRaw = req.body?.ticketIds;
    const ticketIds = Array.isArray(idsRaw) ? idsRaw.map(s).filter(Boolean) : [];

    if (!ticketIds.length) {
      return res.status(400).json({
        success: false,
        message: "ticketIds array is required.",
      });
    }

    // fetch tickets for cloudinary cleanup
    const tickets = await CustomerTicketModal.find({ ticketId: { $in: ticketIds } })
      .select({ ticketId: 1, attachments: 1 })
      .lean();

    if (!tickets.length) {
      return res.status(404).json({ success: false, message: "No matching tickets found." });
    }

    // best-effort: delete cloudinary attachments
    const publicIds = tickets
      .flatMap((t) => (t.attachments || []).map((a) => s(a?.publicId)))
      .filter(Boolean);

    if (publicIds.length && cloudinary?.uploader?.destroy) {
      await Promise.allSettled(publicIds.map((pid) => cloudinary.uploader.destroy(pid)));
    }

    const foundIds = tickets.map((t) => t.ticketId);
    const del = await CustomerTicketModal.deleteMany({ ticketId: { $in: foundIds } });

    return res.json({
      success: true,
      message: "Bulk delete complete.",
      requested: ticketIds.length,
      found: foundIds.length,
      deleted: Number(del?.deletedCount || 0),
      deletedIds: foundIds,
    });
  } catch (err) {
    console.error("bulkDeleteTickets error:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Server error bulk deleting tickets.",
    });
  }
};


/* ===================================================================
   ✅ BULK STATUS UPDATE (admin)
   PATCH /api/support/tickets/bulk-status
   Body: { ticketIds: ["T1","T2"], status: "IN_PROGRESS" }
=================================================================== */
export const bulkUpdateTicketStatus = async (req, res) => {
  try {
    const idsRaw = req.body?.ticketIds;
    const status = upper(req.body?.status);

    const ticketIds = Array.isArray(idsRaw)
      ? idsRaw.map(s).filter(Boolean)
      : [];

    if (!ticketIds.length) {
      return res.status(400).json({
        success: false,
        message: "ticketIds array is required.",
      });
    }

    if (!STATUS.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status.",
      });
    }

    const update = {
      status,
      resolvedAt:
        status === "RESOLVED" || status === "CLOSED"
          ? new Date()
          : null,
    };

    const result = await CustomerTicketModal.updateMany(
      { ticketId: { $in: ticketIds } },
      { $set: update }
    );

    return res.json({
      success: true,
      message: "Bulk status update complete.",
      requested: ticketIds.length,
      matched: result?.matchedCount || 0,
      modified: result?.modifiedCount || 0,
      status,
    });
  } catch (err) {
    console.error("bulkUpdateTicketStatus error:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Server error bulk updating tickets.",
    });
  }
};

