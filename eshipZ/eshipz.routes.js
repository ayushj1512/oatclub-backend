import express from "express";
import { createEshipzShipment } from "./eshipz.controller.js";

const router = express.Router();

router.post("/create", createEshipzShipment);

export default router;