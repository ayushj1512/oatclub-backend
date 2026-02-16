import express from "express";
import { upload } from "../config/cloudinary.js";
import {
  createTicket,
  getTicketsByEmail,
  getTicketByTicketId,
  updateTicketStatus,
  getTicketsAdminList,
  searchTickets,
  deleteTicket
} from "./customerTicket.controller.js";

const router = express.Router();

// ✅ USER: CREATE TICKET (multipart/form-data)
router.post("/tickets", upload.array("files", 5), createTicket);

// ✅ ADMIN/SUPPORT: LIST ALL TICKETS (filters/search/pagination)
// /api/support/tickets?status=OPEN&issueType=Order%20Issue&q=delay&page=1&limit=15
router.get("/tickets", getTicketsAdminList);

// ✅ ADMIN/SUPPORT: PARTIAL SEARCH (username / email / ticketId / subject / message etc.)
// /api/support/tickets/search?q=ayushjuneja&page=1&limit=50
// IMPORTANT: Keep this ABOVE /tickets/:ticketId
router.get("/tickets/search", searchTickets);

// ✅ USER: GET tickets by email (exact email)
// /api/support/tickets/by-email?email=...&page=1&limit=10
// IMPORTANT: Keep this ABOVE /tickets/:ticketId
router.get("/tickets/by-email", getTicketsByEmail);

// ✅ USER/ADMIN: GET single ticket by ticketId
router.get("/tickets/:ticketId", getTicketByTicketId);

// ✅ ADMIN/SUPPORT: UPDATE status + adminNotes
router.patch("/tickets/:ticketId/status", updateTicketStatus);

router.delete("/tickets/:ticketId", deleteTicket);


export default router;
