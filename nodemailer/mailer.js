import nodemailer from "nodemailer";
import "dotenv/config";

import { userOnboardingTemplate } from "./events/UserOnboardingEmailTempalte.js";
import { orderConfirmationTemplate } from "./events/OrderConfirmationTemplate.js";
import { orderCancellationTemplate } from "./events/OrderCancellationEmailTemplate.js";
import { orderReceivedAdminTemplate } from "./events/AdminOrderReceivedTemplate.js";
import { rmaCreatedTemplate } from "./events/RmaEmailTemplate.js";
import { orderTrackingTemplate } from "./events/OrderTrackingTemplate.js";
import { orderShippedTemplate } from "./events/OrderShippedTemplate.js";
import { orderDeliveredTemplate } from "./events/OrderDeliveredTemplate.js";
import { orderPaymentPendingTemplate } from "./events/OrderPaymentPendingTemplate.js";
import {
  adminUserTaskEmailTemplate,
} from "./events/AdminUserTaskEmailTemplate.js";
import { customerCreditCreditedTemplate } from "./events/CustomerCreditCreditedTemplate.js";

const MAIL_ENABLED = String(process.env.MAIL_ENABLED).toLowerCase() !== "false";

console.log("📨 MAIL_ENABLED:", process.env.MAIL_ENABLED);
console.log("📧 MAIL_USER:", process.env.MAIL_USER);
console.log("🔐 MAIL_PASS:", process.env.MAIL_PASS ? "✅ present" : "❌ missing");

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || "smtp.gmail.com",
    port: Number(process.env.MAIL_PORT || 587),
    secure: String(process.env.MAIL_SECURE).toLowerCase() === "true",
    requireTLS: Number(process.env.MAIL_PORT || 587) === 587,
    name: process.env.MAIL_EHLO_NAME || process.env.SMTP_EHLO_NAME || "oatclub.in",
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
    pool: true,
    maxConnections: Number(process.env.MAIL_MAX_CONNECTIONS || 2),
    maxMessages: Number(process.env.MAIL_MAX_MESSAGES || 500),
  });

  cachedTransporter.verify((err) => {
    if (err) console.error("❌ SMTP verify failed:", err.message);
    else console.log("✅ SMTP server ready to send emails");
  });

  return cachedTransporter;
}

export async function sendMail({ to, subject, text, html, headers = {} }) {
  if (!MAIL_ENABLED) {
    console.log("📭 MAIL_ENABLED false → skipping mail", { to, subject });
    return { disabled: true };
  }

  if (!to) throw new Error("Recipient email missing");
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    throw new Error("MAIL_USER or MAIL_PASS missing in .env");
  }

  const transporter = getTransporter();

  const from = process.env.MAIL_FROM || `OATCLUB <${process.env.MAIL_USER}>`;
  const replyTo = process.env.MAIL_REPLY_TO || process.env.MAIL_USER;
  const envelopeFrom = process.env.MAIL_ENVELOPE_FROM || process.env.MAIL_USER;

  console.log("📤 Sending mail...", { to, subject, from, replyTo });

  const info = await transporter.sendMail({
    from,
    replyTo,
    to,
    subject,
    text,
    html,
    headers,
    envelope: {
      from: envelopeFrom,
      to,
    },
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

    return sendMail({
      to,
      subject,
      text,
      html,
    });
  },

  sendOrderConfirmation: async ({
    to,
    name,
    order,
    ctaUrl,
  }) => {
    const { subject, text, html } = orderConfirmationTemplate({
      name,
      order,
      ctaUrl,
    });

    return sendMail({
      to,
      subject,
      text,
      html,
    });
  },

  sendOrderPaymentPending: async ({
    to,
    name,
    order,
    paymentLink,
    expiresAt,
  }) => {
    const { subject, text, html } = orderPaymentPendingTemplate({
      name,
      order,
      paymentLink,
      expiresAt,
    });

    return sendMail({
      to,
      subject,
      text,
      html,
    });
  },

  sendOrderCancelled: async ({
    to,
    name,
    order,
    ctaUrl,
    reason,
  }) => {
    const { subject, text, html } = orderCancellationTemplate({
      name,
      order,
      ctaUrl,
      reason,
    });

    return sendMail({
      to,
      subject,
      text,
      html,
    });
  },

  sendOrderCancellation: async ({
    to,
    name,
    order,
    ctaUrl,
    reason,
  }) => {
    return Mailer.sendOrderCancelled({
      to,
      name,
      order,
      ctaUrl,
      reason,
    });
  },

  sendAdminOrderReceived: async ({
    to,
    order,
    ctaUrl,
  }) => {
    const { subject, text, html } = orderReceivedAdminTemplate({
      order,
      ctaUrl,
    });

    return sendMail({
      to,
      subject,
      text,
      html,
    });
  },

  sendRmaCreated: async ({
    to,
    name,
    order,
    rma,
    policy,
    ctaUrl,
  }) => {
    const { subject, text, html } = rmaCreatedTemplate({
      name,
      order,
      rma,
      policy,
      ctaUrl,
    });

    return sendMail({
      to,
      subject,
      text,
      html,
    });
  },

  sendOrderTracking: async ({
    to,
    name,
    awb,
    courierName,
    trackingLink,
    order,
    ctaUrl,
  }) => {
    const { subject, text, html } = orderTrackingTemplate({
      name,
      awb,
      courierName,
      trackingLink,
      order,
      ctaUrl,
    });

    return sendMail({
      to,
      subject,
      text,
      html,
    });
  },

  sendOrderShipped: async ({
    to,
    name,
    order,
    ctaUrl,
    awb,
    courierName,
    trackingLink,
  }) => {
    const patchedOrder = patchShipment(
      order,
      awb,
      courierName,
      trackingLink,
    );

    const { subject, text, html } = orderShippedTemplate({
      name,
      order: patchedOrder,
      ctaUrl,
    });

    return sendMail({
      to,
      subject,
      text,
      html,
    });
  },

  sendOrderOutForDelivery: async ({
    to,
    name,
    order,
    ctaUrl,
    awb,
    courierName,
    trackingLink,
  }) => {
    const { subject, text, html } = orderTrackingTemplate({
      name,
      awb,
      courierName,
      trackingLink: trackingLink || ctaUrl,
      order: {
        ...(order || {}),
        emailStatusLabel: "Out for Delivery",
      },
      ctaUrl,
    });

    return sendMail({
      to,
      subject:
        subject ||
        `Order Out for Delivery — #${order?.orderNumber || order?._id
        }`,
      text,
      html,
    });
  },

  sendOrderDelivered: async ({
    to,
    name,
    order,
    ctaUrl,
    awb,
    courierName,
    trackingLink,
  }) => {
    const patchedOrder = patchShipment(
      order,
      awb,
      courierName,
      trackingLink,
    );

    const { subject, text, html } = orderDeliveredTemplate({
      name,
      order: patchedOrder,
      ctaUrl,
    });

    return sendMail({
      to,
      subject,
      text,
      html,
    });
  },

  sendAdminUserTaskEmail: async ({
    to,
    eventType,
    task,
    recipient,
    actor,
    message = "",
    feedback = "",
    ctaUrl,
    brandName = "OATCLUB",
    supportEmail,
  }) => {
    const { subject, text, html } =
      adminUserTaskEmailTemplate({
        eventType,
        task,
        recipient,
        actor,
        message,
        feedback,
        ctaUrl,
        brandName,
        supportEmail,
      });

    return sendMail({
      to,
      subject,
      text,
      html,
      headers: {
        "X-OATCLUB-Notification-Type": "admin-user-task",
        "X-OATCLUB-Task-Event": eventType || "task_updated",
        "X-OATCLUB-Task-Id": String(
          task?._id || task?.taskNumber || "",
        ),
      },
    });
  },
};

function patchShipment(order, awb, courierName, trackingLink) {
  return {
    ...(order || {}),
    shipment: {
      ...(order?.shipment || {}),
      shiprocket: {
        ...(order?.shipment?.shiprocket || {}),
        awb: awb || order?.shipment?.shiprocket?.awb || "",
        courierName:
          courierName || order?.shipment?.shiprocket?.courierName || "",
        trackingUrl:
          trackingLink || order?.shipment?.shiprocket?.trackingUrl || "",
      },
    },
  };
}

sendCustomerCreditCredited: async ({
  to,
  name,
  amount,
  balance,
  orderNumber,
  creditId,
  reason,
  creditedAt,
  ctaUrl,
}) => {
  const { subject, text, html } =
    customerCreditCreditedTemplate({
      name,
      amount,
      balance,
      orderNumber,
      creditId,
      reason,
      creditedAt,
      ctaUrl,
    });

  return sendMail({
    to,
    subject,
    text,
    html,
  });
}
