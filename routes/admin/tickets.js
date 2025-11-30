import express from "express";
import {
  createTicket,
  getAllTickets,
  getTicketById,
  updateTicket,
  updateTicketStatus,
  addComment,
  deleteTicket,
} from "../../controller/admin/ticketController.js";

const router = express.Router();

// Create a ticket
router.post("/", createTicket);

// Get all tickets
router.get("/", getAllTickets);

// Get single ticket
router.get("/:id", getTicketById);

// Update ticket
router.put("/:id", updateTicket);

// Update ticket status
router.patch("/:id/status", updateTicketStatus);

// Add comment to ticket
router.post("/:id/comment", addComment);

// Delete ticket
router.delete("/:id", deleteTicket);

export default router;   // ✅ REQUIRED FOR ESM
