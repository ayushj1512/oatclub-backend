import express from "express";
import {
  sendEmail,
  onboardingMail,
  orderPlacedMail,
  deliveredMail,
  rmaRequestMail,
  newsSubscriptionMail,
} from "./index.js";

const router = express.Router();

/**
 * ✅ TEST ROUTE
 * GET /api/mail/test?to=email@example.com
 */
router.get("/test", async (req, res) => {
  try {
    const to = req.query.to || process.env.MAIL_USER;

    const info = await sendEmail({
      to,
      subject: "✅ MIRAY FASHIONS - Test Email",
      text: "If you received this, Google Workspace SMTP is working!",
      html: `<h2>✅ MIRAY FASHIONS</h2><p>SMTP setup working properly.</p>`,
    });

    return res.json({ success: true, message: "Mail Sent ✅", info });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ✅ POST /api/mail/onboarding
 * body: { user: { name, email } }
 */
router.post("/onboarding", async (req, res) => {
  try {
    const { user } = req.body;
    const info = await onboardingMail(user);

    return res.json({ success: true, message: "Onboarding Mail Sent ✅", info });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ✅ POST /api/mail/order-placed
 * body: { user: { name, email }, order: { orderId } }
 */
router.post("/order-placed", async (req, res) => {
  try {
    const { user, order } = req.body;
    const info = await orderPlacedMail(user, order);

    return res.json({ success: true, message: "Order Placed Mail Sent ✅", info });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ✅ POST /api/mail/delivered
 * body: { user: { name, email }, order: { orderId } }
 */
router.post("/delivered", async (req, res) => {
  try {
    const { user, order } = req.body;
    const info = await deliveredMail(user, order);

    return res.json({ success: true, message: "Delivered Mail Sent ✅", info });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ✅ POST /api/mail/rma
 * body: { user: { name, email }, rma: { rmaId } }
 */
router.post("/rma", async (req, res) => {
  try {
    const { user, rma } = req.body;
    const info = await rmaRequestMail(user, rma);

    return res.json({ success: true, message: "RMA Mail Sent ✅", info });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ✅ POST /api/mail/newsletter
 * body: { subscriber: { email } }
 */
router.post("/newsletter", async (req, res) => {
  try {
    const { subscriber } = req.body;
    const info = await newsSubscriptionMail(subscriber);

    return res.json({ success: true, message: "Newsletter Mail Sent ✅", info });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
