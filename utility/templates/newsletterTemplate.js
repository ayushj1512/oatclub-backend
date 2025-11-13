// utils/emailTemplates/newsletterTemplate.js
import { baseTemplate } from "./baseTemplate.js";

export const newsletterSubscriptionEmail = (email) =>
  baseTemplate(
    "Thanks for Subscribing 🧡",
    `
    <p>Hey there!</p>
    <p>We’re excited to have you join our community. You’ll now receive updates on:</p>
    <ul>
      <li>🆕 New product launches</li>
      <li>💸 Exclusive subscriber-only offers</li>
      <li>📖 Latest blog posts and trends</li>
    </ul>
    <p>Your subscription is linked to: <strong>${email}</strong></p>
    <p>Welcome to the family! 🎉</p>
    `
  );
