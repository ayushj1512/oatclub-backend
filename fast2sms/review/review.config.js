export const FAST2SMS_REVIEW_CONFIG = {
  TEMPLATE_NAME:
    process.env.FAST2SMS_REVIEW_TEMPLATE_NAME || "customer_review_template",

  TEMPLATE_ID: process.env.FAST2SMS_REVIEW_TEMPLATE_ID || "918493947867146",

  TEMPLATE_LANGUAGE:
    process.env.FAST2SMS_REVIEW_TEMPLATE_LANGUAGE || "en",

  SENDER_NUMBER:
    process.env.FAST2SMS_REVIEW_SENDER_NUMBER || "+919560797469",

  MESSAGE_ID: process.env.FAST2SMS_REVIEW_MESSAGE_ID || "21126",

  CLIENT_URL:
    process.env.CLIENT_URL || "https://www.mirayfashions.com",
};