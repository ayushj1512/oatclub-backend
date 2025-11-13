// utils/emailTemplates/offerTemplate.js
import { baseTemplate } from "./baseTemplate.js";

export const newOfferEmail = (title, description, ctaLink) =>
  baseTemplate(
    "🔥 New Offer Just for You!",
    `
    <h2>${title}</h2>
    <p>${description}</p>
    <a href="${ctaLink}" style="display:inline-block; background:#28a745; color:#fff; text-decoration:none; padding:12px 24px; border-radius:6px;">Grab Offer</a>
    <p>Hurry! This offer won’t last long ⚡</p>
    `
  );
