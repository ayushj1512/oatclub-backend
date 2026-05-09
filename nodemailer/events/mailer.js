import nodemailer from "nodemailer";
import "dotenv/config";

import { userOnboardingTemplate } from "./UserOnboardingEmailTempalte.js";
import { orderConfirmationTemplate } from "./OrderConfirmationTemplate.js";
import { orderCancellationTemplate } from "./OrderCancellationEmailTemplate.js";
import { orderReceivedAdminTemplate } from "./AdminOrderReceivedTemplate.js";
import { rmaCreatedTemplate } from "./RmaEmailTemplate.js";
import { orderTrackingTemplate } from "./OrderTrackingTemplate.js";
import { orderShippedTemplate } from "./OrderShippedTemplate.js";
import { orderDeliveredTemplate } from "./OrderDeliveredTemplate.js";

const MAIL_ENABLED = process.env.MAIL_ENABLED === "true";

console.log("📨 MAIL_ENABLED (mailer):", process.env.MAIL_ENABLED);
console.log("📧 MAIL_USER (mailer):", process.env.MAIL_USER);
console.log(
  "🔐 MAIL_PASS (mailer):",
  process.env.MAIL_PASS ? "✅ present" : "❌ missing"
);

let transporter = null;

if (MAIL_ENABLED) {
  transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || "smtp.gmail.com",
    port: Number(process.env.MAIL_PORT || 587),
    secure: process.env.MAIL_SECURE === "true",
    name: process.env.MAIL_EHLO_NAME || "mirayfashions.com",
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });

  transporter.verify((err) => {
    if (err) {
      console.error("❌ SMTP verify failed:", err.message);
    } else {
      console.log("✅ SMTP server ready to send emails");
    }
  });
} else {
  console.log("📭 MAIL_ENABLED is false, mailer disabled");
}

/**
 * ✅ Generic Send Helper
 */
async function sendMail({ to, subject, text, html }) {
  if (!MAIL_ENABLED) {
    console.log("📭 MAIL_ENABLED false → skipping mail send", { to, subject });
    return;
  }

  if (!transporter) {
    console.log("📭 transporter missing → cannot send mail", { to, subject });
    return;
  }

  if (!to) throw new Error("Recipient email missing!");

  const from = process.env.MAIL_FROM || process.env.MAIL_USER;
  const replyTo = process.env.MAIL_REPLY_TO || from;

  console.log("📤 Sending mail...", { to, subject, from, replyTo });

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
    replyTo,
  });

  console.log(`✅ Email sent → ${to} | ${subject}`);
  return info;
}

/**
 * ✅ Mailer Wrapper
 */
export const Mailer = {
  /**
   * ✅ User Onboarding
   */
  sendUserOnboarding: async ({ to, name, ctaUrl, brandName, supportEmail }) => {
    const { subject, text, html } = userOnboardingTemplate({
      name,
      ctaUrl,
      brandName,
      supportEmail,
    });

    return sendMail({ to, subject, text, html });
  },

  /**
   * ✅ Customer Order Confirmation
   */
  sendOrderConfirmation: async ({ to, name, order, ctaUrl }) => {
    const { subject, text, html } = orderConfirmationTemplate({
      name,
      order,
      ctaUrl,
    });

    return sendMail({ to, subject, text, html });
  },

  /**
   * ✅ Customer + Admin Order Cancelled
   */
  sendOrderCancelled: async ({ to, name, order, ctaUrl, reason }) => {
    const { subject, text, html } = orderCancellationTemplate({
      name,
      order,
      ctaUrl,
      reason,
    });

    return sendMail({ to, subject, text, html });
  },

  /**
   * ✅ Backward compatibility alias
   */
  sendOrderCancellation: async ({ to, name, order, ctaUrl, reason }) => {
    return Mailer.sendOrderCancelled({ to, name, order, ctaUrl, reason });
  },

  /**
   * ✅ Admin Order Received
   */
  sendAdminOrderReceived: async ({ to, order, ctaUrl }) => {
    const { subject, text, html } = orderReceivedAdminTemplate({
      order,
      ctaUrl,
    });

    return sendMail({ to, subject, text, html });
  },

  /**
   * ✅ RMA Created Email
   */
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

  /**
   * ✅ Generic Tracking Email
   */
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

    return sendMail({ to, subject, text, html });
  },

  /**
   * ✅ Order Shipped Email
   * Used by order.emails.js:
   * Mailer.sendOrderShipped(...)
   */
  sendOrderShipped: async ({
    to,
    name,
    order,
    ctaUrl,
    awb,
    courierName,
    trackingLink,
  }) => {
    const patchedOrder = {
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

    const { subject, text, html } = orderShippedTemplate({
      name,
      order: patchedOrder,
      ctaUrl,
    });

    return sendMail({ to, subject, text, html });
  },

  /**
   * ✅ Out For Delivery Email
   * Fallback uses tracking template for now.
   */
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
      subject: subject || `Order Out for Delivery — #${order?.orderNumber || order?._id}`,
      text,
      html,
    });
  },

  /**
   * ✅ Order Delivered Email
   * Used by order.emails.js:
   * Mailer.sendOrderDelivered(...)
   */
  sendOrderDelivered: async ({
    to,
    name,
    order,
    ctaUrl,
    awb,
    courierName,
    trackingLink,
  }) => {
    const patchedOrder = {
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

    const { subject, text, html } = orderDeliveredTemplate({
      name,
      order: patchedOrder,
      ctaUrl,
    });

    return sendMail({ to, subject, text, html });
  },
};