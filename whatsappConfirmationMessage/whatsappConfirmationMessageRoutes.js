import express from "express";
import {
  sendWhatsappConfirmationMessage,
  receiveWhatsappConfirmationWebhook,
  getWhatsappConfirmationMessages,
  getWhatsappConfirmationMessagesByOrder,
  getWhatsappConfirmationMessageById,
  updateWhatsappConfirmationMessageStatus,
  deleteWhatsappConfirmationMessage,
} from "./whatsappConfirmationMessageController.js";

const router = express.Router();

/* =========================================================
   SEND / WEBHOOK
========================================================= */
router.post("/send", sendWhatsappConfirmationMessage);
router.post("/webhook", receiveWhatsappConfirmationWebhook);

/* =========================================================
   GET
========================================================= */
router.get("/", getWhatsappConfirmationMessages);
router.get("/order/:orderId", getWhatsappConfirmationMessagesByOrder);
router.get("/:id", getWhatsappConfirmationMessageById);

/* =========================================================
   UPDATE / DELETE
========================================================= */
router.patch("/:id/status", updateWhatsappConfirmationMessageStatus);
router.delete("/:id", deleteWhatsappConfirmationMessage);

export default router;