import express from "express";
import {
  bookWithShiprocket,
  createReversePickup,
  getShiprocketTokenApi,
} from "./shipping.controller.js";
import { shiprocketWebhook } from "./shiprocket.webhook.js";

const router = express.Router();

/**
 * BOOK SHIPMENT
 * POST /api/orders/:id/ship
 */
router.post("/orders/:id/ship", bookWithShiprocket);

/**
 * SHIPROCKET TOKEN
 * GET /api/shiprocket/token
 */
router.get("/shiprocket/token", getShiprocketTokenApi);

/**
 * SHIPROCKET WEBHOOK
 * POST /api/shiprocket/webhook
 */
router.post("/shiprocket/webhook", shiprocketWebhook);
router.post("/1bfc4cf60e6c2cc8/1bfc4cf60e6c2cc8", shiprocketWebhook);

// Reverse pickup (RMA)
router.post("/shiprocket/reverse/:orderId/:rmaNumber", createReversePickup);

export default router;
