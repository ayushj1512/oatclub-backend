import express from "express";

import {
  cleanupOtpLogsController,
  deleteOtpLogController,
  getOtpAnalyticsController,
  getOtpLogController,
  getOtpLogsController,
  resendOtpController,
  sendOtpController,
  verifyOtpController,
} from "./otp.controller.js";

const router = express.Router();

/* ================= PUBLIC OTP ROUTES ================= */

// Existing generic routes: email + WhatsApp
router.post("/send", sendOtpController);
router.post("/resend", resendOtpController);
router.post("/verify", verifyOtpController);

/* =============== WHATSAPP OTP ROUTES ================ */

const useWhatsappChannel = (req, _res, next) => {
  req.body = {
    ...(req.body || {}),
    channel: "whatsapp",
  };

  next();
};

router.post(
  "/whatsapp/send",
  useWhatsappChannel,
  sendOtpController,
);

router.post(
  "/whatsapp/resend",
  useWhatsappChannel,
  resendOtpController,
);

router.post(
  "/whatsapp/verify",
  useWhatsappChannel,
  verifyOtpController,
);

/* ================= ADMIN OTP ROUTES ================== */

// Add your admin authentication middleware here.
router.get("/logs", getOtpLogsController);

router.get(
  "/analytics",
  getOtpAnalyticsController,
);

router.post(
  "/cleanup",
  cleanupOtpLogsController,
);

router.get(
  "/logs/:id",
  getOtpLogController,
);

router.delete(
  "/logs/:id",
  deleteOtpLogController,
);

export default router;
