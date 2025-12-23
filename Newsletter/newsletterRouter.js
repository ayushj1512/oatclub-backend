import express from "express";
import {
  addSubscription,
  getAllSubscriptions,
  sendBulkNewsletterUpdate, // ✅ correct import
} from "./newsletterController.js";

const router = express.Router();

/* --------------------------------------------------
   PUBLIC ROUTES
   Used by frontend (modal / footer)
-------------------------------------------------- */

/**
 * Subscribe single OR bulk emails
 * POST /api/newsletters/subscribe
 *
 * Body:
 *  { email: "a@b.com" }
 *  OR
 *  { emails: ["a@b.com", "b@c.com"] }
 */
router.post("/subscribe", addSubscription);

/* --------------------------------------------------
   ADMIN ROUTES
   (Later protect with admin auth middleware)
-------------------------------------------------- */

/**
 * Get all subscribers
 * GET /api/newsletters/subscribers
 */
router.get("/subscribers", getAllSubscriptions);

/**
 * 🔥 SEND BULK NEWSLETTER
 * POST /api/newsletters/send
 *
 * Body:
 * {
 *   subject: "Winter Sale Live",
 *   html: "<h1>Flat 40% OFF</h1>"
 * }
 */
router.post("/send", sendBulkNewsletterUpdate);

export default router;
