import { sendWhatsappTemplateMessage } from "../fast2sms.whatsapp.js";
import { FAST2SMS_REVIEW_CONFIG } from "./review.config.js";
import {
  buildReviewLink,
  getReviewCustomerName,
  getReviewPhone,
  getReviewProductSummary,
} from "./review.utils.js";

export const sendOrderReviewWhatsapp = async ({ order }) => {
  if (!order) {
    throw new Error("Order is required for review WhatsApp");
  }

  const rawPhone = getReviewPhone(order);
  const phone = String(rawPhone || "").replace(/\D/g, "").slice(-10);

  const customerName = getReviewCustomerName(order);
  const orderNumber = order?.orderNumber;
  const productSummary = getReviewProductSummary(order);
  const reviewLink = buildReviewLink(orderNumber);

  if (!phone || phone.length !== 10) {
    throw new Error(`Invalid customer phone for review WhatsApp: ${rawPhone}`);
  }

  if (!orderNumber) {
    throw new Error("Order number missing for review WhatsApp");
  }

  const payload = {
    phone,
    templateName: FAST2SMS_REVIEW_CONFIG.TEMPLATE_NAME,
    templateId: FAST2SMS_REVIEW_CONFIG.TEMPLATE_ID,
    messageId: FAST2SMS_REVIEW_CONFIG.MESSAGE_ID,
    senderNumber: FAST2SMS_REVIEW_CONFIG.SENDER_NUMBER,
    language: FAST2SMS_REVIEW_CONFIG.TEMPLATE_LANGUAGE,

    headerVariables: [customerName],
    bodyVariables: [orderNumber, productSummary, reviewLink],
  };

  console.log("📲 REVIEW WHATSAPP PAYLOAD:", payload);

  const res = await sendWhatsappTemplateMessage(payload);

  console.log("📲 REVIEW WHATSAPP FAST2SMS RESPONSE:", JSON.stringify(res, null, 2));

  if (!res?.success) {
    throw new Error(
      res?.data?.message ||
        res?.data?.error ||
        res?.error ||
        "Fast2SMS review WhatsApp failed"
    );
  }

  return res;
};