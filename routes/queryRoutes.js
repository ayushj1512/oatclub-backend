import express from "express";
import {
  createQuery,
  getAllQueries,
  getQueryById,
  updateQuery,
  deleteQuery,
} from "../controllers/queryController.js";

const router = express.Router();

router.post("/", createQuery);
router.get("/", getAllQueries);
router.get("/:id", getQueryById);
router.put("/:id", updateQuery);
router.delete("/:id", deleteQuery);

export default router;
