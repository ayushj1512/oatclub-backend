// utils/emailTemplates/onboardingTemplate.js
import { baseTemplate } from "./baseTemplate.js";

export const onboardingEmail = (name) =>
  baseTemplate(
    "Welcome to YourBrand 🎉",
    `
    <p>Hey ${name},</p>
    <p>We’re thrilled to have you join the <strong>YourBrand</strong> family!</p>
    <p>Start exploring our latest products, exclusive discounts, and new arrivals today.</p>
    <a href="https://yourdomain.com/shop" style="display:inline-block; background:#ff6600; color:#fff; text-decoration:none; padding:10px 20px; border-radius:6px;">Start Shopping</a>
    <p>Need any help? Just reply to this email — we’re always here for you 💬</p>
    `
  );
