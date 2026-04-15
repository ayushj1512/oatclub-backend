import express from "express";
import {
  createTailor,
  getAllTailors,
  getTailorById,
  updateTailor,
  deleteTailor,
} from "./tailor.controller.js";

const router = express.Router();

router.post("/", createTailor);
router.get("/", getAllTailors);
router.get("/:id", getTailorById);
router.put("/:id", updateTailor);
router.delete("/:id", deleteTailor);

export default router;