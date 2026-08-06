export const FAST2SMS_CONFIG = Object.freeze({
  API_KEY: process.env.FAST2SMS_API_KEY,

  BASE_URL:
    process.env.FAST2SMS_BASE_URL ||
    "https://www.fast2sms.com/dev",

  PHONE_NUMBER_ID:
    "1093796253824604",

  WHATSAPP_VERSION:
    process.env.FAST2SMS_WHATSAPP_VERSION || "v24.0",

  ENDPOINTS: {
    SEND_SIMPLE: "/whatsapp",
    LOGS: "/whatsapp_logs",
  },
});
