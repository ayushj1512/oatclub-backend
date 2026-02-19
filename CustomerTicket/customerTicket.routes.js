import express from "express";
import { upload } from "../config/cloudinary.js";
import {
  createTicket,
  getTicketsByEmail,
  getTicketByTicketId,
  updateTicketStatus,
  getTicketsAdminList,
  searchTickets,
  deleteTicket,
  bulkDeleteTickets,      // ✅ NEW
  bulkUpdateTicketStatus, // ✅ NEW (if you already have it / add it)
} from "./customerTicket.controller.js";

const router = express.Router();

/* =========================
   USER: CREATE TICKET
========================= */
router.post("/tickets", upload.array("files", 5), createTicket);

/* =========================
   ADMIN: BULK OPS (put ABOVE :ticketId)
========================= */
// ✅ BULK STATUS
// PATCH /api/support/tickets/bulk-status  { ticketIds:[], status:"IN_PROGRESS" }
router.patch("/tickets/bulk-status", bulkUpdateTicketStatus);

// ✅ BULK DELETE
// DELETE /api/support/tickets/bulk-delete { ticketIds:[] }
router.delete("/tickets/bulk-delete", bulkDeleteTickets);

/* =========================
   ADMIN/SUPPORT: LIST + SEARCH
========================= */
// /api/support/tickets?status=OPEN&issueType=Order%20Issue&q=delay&page=1&limit=15
router.get("/tickets", getTicketsAdminList);

// /api/support/tickets/search?q=ayushjuneja&page=1&limit=50
router.get("/tickets/search", searchTickets);

// /api/support/tickets/by-email?email=...&page=1&limit=10
router.get("/tickets/by-email", getTicketsByEmail);

/* =========================
   SINGLE TICKET OPS
========================= */
router.get("/tickets/:ticketId", getTicketByTicketId);

// PATCH /api/support/tickets/:ticketId/status  { status, adminNotes }
router.patch("/tickets/:ticketId/status", updateTicketStatus);

// DELETE /api/support/tickets/:ticketId
router.delete("/tickets/:ticketId", deleteTicket);

export default router;
