export const FAST2SMS_CONFIG = {
  API_KEY: process.env.FAST2SMS_API_KEY,
  BASE_URL: process.env.FAST2SMS_BASE_URL || "https://www.fast2sms.com/dev",

  PHONE_NUMBER_ID: process.env.FAST2SMS_PHONE_NUMBER_ID,

  TEMPLATES: {
    ORDER_CONFIRMATION: process.env.FAST2SMS_ORDER_CONFIRM_TEMPLATE_ID,
  },

  WHATSAPP: {
    SEND: "/whatsapp",
    SESSION: "/whatsapp-session",
    LOGS: "/whatsapp_logs",
  },
};