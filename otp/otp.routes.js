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

// Apne existing admin middleware ka path use karo.
// import { protectAdmin } from "../middleware/adminAuth.js";

const router = express.Router();

/* =========================================================
   PUBLIC OTP ROUTES
========================================================= */

router.post("/send", sendOtpController);

router.post("/resend", resendOtpController);

router.post("/verify", verifyOtpController);

/* =========================================================
   ADMIN OTP LOG ROUTES

   Production mein protectAdmin middleware zaroor lagana:
   router.get("/logs", protectAdmin, getOtpLogsController);
========================================================= */

router.get("/logs", getOtpLogsController);

router.get(
  "/analytics",
  getOtpAnalyticsController
);

router.post(
  "/cleanup",
  cleanupOtpLogsController
);

router.get(
  "/logs/:id",
  getOtpLogController
);

router.delete(
  "/logs/:id",
  deleteOtpLogController
);

export default router;