export const FAST2SMS_CONFIG = {
  API_KEY: process.env.FAST2SMS_API_KEY,
  BASE_URL: "https://www.fast2sms.com/dev",

  WHATSAPP: {
    SEND: "/whatsapp",
    SESSION: "/whatsapp-session",
    LOGS: "/whatsapp_logs",
  },
};