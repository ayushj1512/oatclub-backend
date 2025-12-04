import express from "express";
import {
  createAttribute,
  getAllAttributes,
  getAttributeById,
  updateAttribute,
  deleteAttribute,
} from "../controller/attributeController.js";

const router = express.Router();

/* ============================================================================
   ATTRIBUTE ROUTES
   Base URL: /api/attributes
============================================================================ */

router.post("/", createAttribute);        // Create
router.get("/", getAllAttributes);        // List all
router.get("/:id", getAttributeById);     // Get single
router.put("/:id", updateAttribute);      // Update
router.delete("/:id", deleteAttribute);   // Delete

export default router;
