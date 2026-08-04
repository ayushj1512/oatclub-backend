import { sendFast2SmsWhatsappTemplate } from "../fast2sms.whatsapp.js";
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
    throw new Error(
      `Invalid customer phone for review WhatsApp: ${rawPhone}`
    );
  }

  if (!orderNumber) {
    throw new Error("Order number missing for review WhatsApp");
  }

  const variables = [
    customerName,
    orderNumber,
    productSummary,
    reviewLink,
  ];

  console.log("📲 REVIEW WHATSAPP PAYLOAD:", {
    phone,
    templateKey: "CUSTOMER_REVIEW",
    variables,
  });

  const res = await sendFast2SmsWhatsappTemplate({
    phone,
    templateKey: "CUSTOMER_REVIEW",
    variables,
    udf1: orderNumber,
    udf2: "customer_review",
  });

  console.log(
    "📲 REVIEW WHATSAPP FAST2SMS RESPONSE:",
    JSON.stringify(res, null, 2)
  );

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
