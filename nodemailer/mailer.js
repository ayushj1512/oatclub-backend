import nodemailer from "nodemailer";

import { userOnboardingTemplate } from "./UserOnboardingEmailTempalte.js";
import { orderConfirmationTemplate } from "./OrderConfirmationTemplate.js";
import { orderCancellationTemplate } from "./OrderCancellationEmailTemplate.js";
import { orderReceivedAdminTemplate } from "./AdminOrderReceivedTemplate.js";
import { rmaCreatedTemplate } from "./RmaEmailTemplate.js";
import { orderTrackingTemplate } from "./OrderTrackingTemplate.js";
import { orderDeliveredTemplate } from "./OrderDeliveredTemplate.js";
import { orderShippedTemplate } from "./OrderShippedTemplate.js";

let cachedTransporter;

function getBool(v, fallback = false) {
  if (v == null) return fallback;
  return String(v).toLowerCase() === "true";
}

function isMailEnabled() {
  return String(process.env.MAIL_ENABLED).toLowerCase() !== "false";
}

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.MAIL_HOST || "smtp-relay.gmail.com";
  const port = Number(process.env.MAIL_PORT || 587);
  const secure = getBool(process.env.MAIL_SECURE, port === 465);

  const config = {
    host,
    port,
    secure,

    // Relay on 587 should use STARTTLS
    requireTLS: true,

    // Avoid HELO/EHLO mismatch warnings
    name: process.env.SMTP_EHLO_NAME || "mirayfashions.com",

    // Reuse connections
    pool: true,
    maxConnections: Number(process.env.MAIL_MAX_CONNECTIONS || 2),
    maxMessages: Number(process.env.MAIL_MAX_MESSAGES || 500),
    rateDelta: Number(process.env.MAIL_RATE_DELTA || 1000),
    rateLimit: Number(process.env.MAIL_RATE_LIMIT || 5),

    // Timeouts
    connectionTimeout: Number(process.env.MAIL_CONN_TIMEOUT || 30_000),
    greetingTimeout: Number(process.env.MAIL_GREET_TIMEOUT || 30_000),
    socketTimeout: Number(process.env.MAIL_SOCKET_TIMEOUT || 60_000),
  };

  // Auth only if provided
  if (process.env.MAIL_USER && process.env.MAIL_PASS) {
    config.auth = {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    };
  }

  cachedTransporter = nodemailer.createTransport(config);

  cachedTransporter.verify((err) => {
    if (err) {
      console.error("❌ SMTP verify failed:", err.message);
    } else {
      console.log("✅ SMTP server ready to send emails");
    }
  });

  return cachedTransporter;
}

export async function sendMail({ to, subject, html, text, headers = {} }) {
  if (!isMailEnabled()) {
    console.log("📭 MAIL_ENABLED false → skipping mail send", { to, subject });
    return { disabled: true };
  }

  if (!to) {
    throw new Error("Recipient email missing");
  }

  const transporter = getTransporter();

  // Force envelope MAIL FROM for better relay acceptance
  const envelopeFrom = process.env.MAIL_ENVELOPE_FROM || process.env.MAIL_USER;
  const from = process.env.MAIL_FROM || process.env.MAIL_USER;
  const replyTo = process.env.MAIL_REPLY_TO || undefined;

  console.log("📤 Sending mail...", {
    to,
    subject,
    from,
    replyTo,
    envelopeFrom,
  });

  const info = await transporter.sendMail({
    from,
    replyTo,
    envelope: {
      from: envelopeFrom,
      to,
    },
    to,
    subject,
    text,
    html,
    headers,
  });

  console.log(`✅ Email sent → ${to} | ${subject}`);
  return info;
}

export const Mailer = {
  sendUserOnboarding: async ({
    to,
    name,
    ctaUrl,
    brandName,
    supportEmail,
  }) => {
    const { subject, text, html } = userOnboardingTemplate({
      name,
      ctaUrl,
      brandName,
      supportEmail,
    });

    return sendMail({ to, subject, text, html });
  },

  sendOrderConfirmation: async ({ to, name, order, ctaUrl }) => {
    const { subject, text, html } = orderConfirmationTemplate({
      name,
      order,
      ctaUrl,
    });

    return sendMail({ to, subject, text, html });
  },

  sendOrderCancelled: async ({ to, name, order, ctaUrl, reason }) => {
    const { subject, text, html } = orderCancellationTemplate({
      name,
      order,
      ctaUrl,
      reason,
    });

    return sendMail({ to, subject, text, html });
  },

  // backward compatibility
  sendOrderCancellation: async ({ to, name, order, ctaUrl, reason }) => {
    return Mailer.sendOrderCancelled({ to, name, order, ctaUrl, reason });
  },

  sendAdminOrderReceived: async ({ to, order, ctaUrl }) => {
    const { subject, text, html } = orderReceivedAdminTemplate({
      order,
      ctaUrl,
    });

    return sendMail({ to, subject, text, html });
  },

  sendRmaCreated: async ({ to, name, order, rma, policy, ctaUrl }) => {
    const { subject, text, html } = rmaCreatedTemplate({
      name,
      order,
      rma,
      policy,
      ctaUrl,
    });

    return sendMail({ to, subject, text, html });
  },

  sendOrderTracking: async ({
    to,
    name,
    awb,
    courierName,
    trackingLink,
    order,
  }) => {
    const { subject, text, html } = orderTrackingTemplate({
      name,
      awb,
      courierName,
      trackingLink,
      order,
    });

    return sendMail({ to, subject, text, html });
  },

  sendOrderShipped: async ({ to, name, order, ctaUrl }) => {
    const { subject, text, html } = orderShippedTemplate({
      name,
      order,
      ctaUrl,
    });

    return sendMail({ to, subject, text, html });
  },

  sendOrderDelivered: async ({ to, name, order, ctaUrl }) => {
    const { subject, text, html } = orderDeliveredTemplate({
      name,
      order,
      ctaUrl,
    });

    return sendMail({ to, subject, text, html });
  },
};