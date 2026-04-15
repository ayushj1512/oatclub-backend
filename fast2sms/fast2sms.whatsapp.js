import { fast2smsRequest } from "./fast2sms.service.js";
import { FAST2SMS_CONFIG } from "./fast2sms.config.js";

export const sendWhatsappTemplateMessage = async ({
  phone,
  templateId,
  variables = [],
}) => {
  return fast2smsRequest({
    method: "GET", // Fast2SMS simple API GET use karta hai
    url: FAST2SMS_CONFIG.WHATSAPP.SEND,
    params: {
      message_id: templateId,
      numbers: phone,
      variables_values: variables.join("|"),
    },
  });
};

export const sendWhatsappSessionMessage = async ({
  phone,
  message,
}) => {
  return fast2smsRequest({
    method: "POST",
    url: FAST2SMS_CONFIG.WHATSAPP.SESSION,
    data: {
      number: phone,
      message,
    },
  });
};