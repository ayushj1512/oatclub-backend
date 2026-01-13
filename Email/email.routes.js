import express from "express";
import {
  sendConfirmationEmail,
  sendTrackingEmail,
  bookCourier,
} from "./email.controller.js"; // ⚠️ adjust path

const router = express.Router();

// ⚠️ If you have admin auth middleware, apply here
// router.use(adminAuth);

router.post("/admin/orders/:id/actions/send-confirmation-email", sendConfirmationEmail);
router.post("/admin/orders/:id/actions/send-tracking-email", sendTrackingEmail);
router.post("/admin/orders/:id/actions/book-courier", bookCourier);

export default router;
