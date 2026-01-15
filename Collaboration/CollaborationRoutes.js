import express from "express";
import {
  createCollaboration,
  listCollaborations,
  getCollaborationById,
  updateCollaboration,
} from "./CollaborationController.js";

const router = express.Router();

// CREATE
router.post("/", createCollaboration);

// READ (LIST)
router.get("/", listCollaborations);

// READ (SINGLE)
router.get("/:id", getCollaborationById);

// UPDATE (NO DELETE)
router.patch("/:id", updateCollaboration);

export default router;
