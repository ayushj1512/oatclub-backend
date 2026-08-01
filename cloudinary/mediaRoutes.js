import express from "express";
import { uploadAny } from "../config/cloudinary.js";

import {
  uploadMedia,
  getMedia,
  deleteMedia,
  syncCloudinaryMedia,
} from "./mediaController.js";

const router = express.Router();

/* =====================================================
   MEDIA
===================================================== */

// Gallery
router.get("/", getMedia);

// Sync both Cloudinary accounts to MongoDB
router.post("/sync", syncCloudinaryMedia);

// Upload (always uploads to Cloudinary 2)
router.post(
  "/upload",
  uploadAny.array("files", 25),
  uploadMedia
);

// Delete (automatically deletes from correct Cloudinary)
router.delete("/:id", deleteMedia);

export default router;