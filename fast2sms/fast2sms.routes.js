import express from "express";

import {
  getFast2SmsTemplateController,
  getFast2SmsTemplatesController,
  sendCodOrderConfirmationController,
  sendOrderConfirmationController,
  sendPaymentCompletedController,
  sendPrepaidOrderConfirmationController,
} from "./fast2sms.controller.js";

const router = express.Router();

/**
 * Template information
 */
router.get(
  "/templates",
  getFast2SmsTemplatesController
);

router.get(
  "/templates/:templateKey",
  getFast2SmsTemplateController
);

/**
 * WhatsApp sending routes
 */
router.post(
  "/whatsapp/order-confirmation",
  sendOrderConfirmationController
);

router.post(
  "/whatsapp/cod-confirmation",
  sendCodOrderConfirmationController
);

router.post(
  "/whatsapp/prepaid-confirmation",
  sendPrepaidOrderConfirmationController
);

router.post(
  "/whatsapp/payment-completed",
  sendPaymentCompletedController
);

export default router;
