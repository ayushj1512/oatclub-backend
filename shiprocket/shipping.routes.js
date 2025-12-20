import express from "express";
import { bookWithShiprocket } from "../controllers/shipping.controller.js";
import { shiprocketWebhook } from "../shiprocket/index.js";

const router = express.Router();

router.post("/shiprocket/book", bookWithShiprocket);
router.post("/shiprocket/webhook", shiprocketWebhook);

export default router;
