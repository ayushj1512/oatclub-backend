// fast2sms/fast2sms.whatsapp.js

import { FAST2SMS_CONFIG } from "./fast2sms.config.js";
import {
  buildOrderActionLink,
  normalizeIndianPhone,
} from "./fast2sms.utils.js";

export const sendWhatsappTemplateMessage = async ({
  phone,
  templateName,
  language = "en",
  headerVariables = [],
  bodyVariables = [],
}) => {
  if (!FAST2SMS_CONFIG.API_KEY) {
    throw new Error("FAST2SMS_API_KEY missing in .env");
  }

  if (!FAST2SMS_CONFIG.PHONE_NUMBER_ID) {
    throw new Error("FAST2SMS_PHONE_NUMBER_ID missing in .env");
  }

  if (!templateName) {
    throw new Error("WhatsApp templateName is required");
  }

  const version = FAST2SMS_CONFIG.WHATSAPP_VERSION || "v24.0";
  const url = `${FAST2SMS_CONFIG.BASE_URL}/whatsapp/${version}/${FAST2SMS_CONFIG.PHONE_NUMBER_ID}/messages`;

  const components = [];

  if (headerVariables.length) {
    components.push({
      type: "header",
      parameters: headerVariables.map((text) => ({
        type: "text",
        text: String(text),
      })),
    });
  }

  if (bodyVariables.length) {
    components.push({
      type: "body",
      parameters: bodyVariables.map((text) => ({
        type: "text",
        text: String(text),
      })),
    });
  }

  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: `+91${normalizeIndianPhone(phone)}`,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      components,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: FAST2SMS_CONFIG.API_KEY,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));

  return {
    success: res.ok && !json?.error,
    status: res.status,
    data: json,
    request: {
      url,
      body,
    },
  };
};

export const sendOrderConfirmationWhatsapp = async ({ order }) => {
  const phone =
    order?.shippingAddressSnapshot?.phone ||
    order?.shippingAddress?.phone ||
    order?.customerId?.phone ||
    order?.customer?.phone;

  const customerName =
    order?.shippingAddressSnapshot?.fullName ||
    order?.shippingAddress?.fullName ||
    order?.customerId?.name ||
    order?.customer?.name ||
    "Customer";

  const orderNumber = order?.orderNumber;
  const actionLink = buildOrderActionLink(orderNumber);

  return sendWhatsappTemplateMessage({
    phone,
    templateName:
      FAST2SMS_CONFIG.TEMPLATES.ORDER_CONFIRMATION_NAME ||
      "order_confirmation_action",
    language:
      FAST2SMS_CONFIG.TEMPLATES.ORDER_CONFIRMATION_LANGUAGE || "en",
    headerVariables: [orderNumber],
    bodyVariables: [customerName, orderNumber, actionLink],
  });
};