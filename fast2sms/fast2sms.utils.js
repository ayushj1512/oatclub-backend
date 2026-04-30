import { FAST2SMS_CONFIG } from "./fast2sms.config.js";

export const cleanPhone = (value = "") => String(value).replace(/\D/g, "");

export const normalizeIndianPhone = (value = "") => {
  let phone = cleanPhone(value);

  if (phone.startsWith("91") && phone.length === 12) {
    phone = phone.slice(2);
  }

  return phone;
};

export const buildOrderActionLink = (orderNumber) =>
  `https://www.mirayfashions.com/orders/action/${encodeURIComponent(orderNumber)}`;

export const nowIST = () =>
  new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
    })
  );

export const assertFast2SMSReady = () => {
  if (!FAST2SMS_CONFIG.API_KEY) {
    throw new Error("FAST2SMS_API_KEY is missing");
  }
};