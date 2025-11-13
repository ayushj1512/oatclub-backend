// utils/emailTemplates/orderUpdateTemplate.js
import { baseTemplate } from "./baseTemplate.js";

export const orderUpdateEmail = (name, orderId, status, trackingUrl = null) =>
  baseTemplate(
    "Order Update 🛍️",
    `
    <p>Hi ${name},</p>
    <p>Your order <strong>#${orderId}</strong> status has been updated:</p>
    <h3 style="color:#ff6600;">${status}</h3>
    ${
      trackingUrl
        ? `<p>You can track your shipment here:</p>
           <a href="${trackingUrl}" style="display:inline-block; background:#007bff; color:#fff; text-decoration:none; padding:10px 20px; border-radius:6px;">Track Package</a>`
        : ""
    }
    <p>Thank you for shopping with us — we’ll keep you posted on every step 📦</p>
    `
  );
