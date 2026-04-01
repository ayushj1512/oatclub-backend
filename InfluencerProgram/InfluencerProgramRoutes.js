import express from "express";
import {
  createInfluencer,
  getAllInfluencers,
  getInfluencerById,
  getInfluencerByCode, // ✅ NEW
  updateInfluencer,
  deleteInfluencer,
  updateInfluencerStatus,
} from "./InfluencerProgramController.js";

const router = express.Router();

/* CRUD */
router.post("/", createInfluencer);
router.get("/", getAllInfluencers);

/* 🔥 IMPORTANT: code route pehle */
router.get("/code/:code", getInfluencerByCode);

router.get("/:id", getInfluencerById);
router.put("/:id", updateInfluencer);
router.delete("/:id", deleteInfluencer);

/* quick status update */
router.patch("/:id/status", updateInfluencerStatus);

export default router;