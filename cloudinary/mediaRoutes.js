import express from "express";
import { uploadAny } from "../config/cloudinary.js";
import { uploadMedia, getMedia, deleteMedia } from "./mediaController.js";

const router = express.Router();

router.get("/", getMedia);
router.post("/upload", uploadAny.array("files", 25), uploadMedia);
router.delete("/:id", deleteMedia);

export default router;
