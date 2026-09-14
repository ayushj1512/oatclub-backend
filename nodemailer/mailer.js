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
import { adminUserTaskEmailTemplate } from "./events/AdminUserTaskEmailTemplate.js";
import { customerCreditCreditedTemplate } from "./events/CustomerCreditCreditedTemplate.js";
import { rmaReversePickupBookedTemplate } from "./events/RmaReversePickupBookedTemplate.js";

const MAIL_ENABLED =
  String(process.env.MAIL_ENABLED).toLowerCase() !== "false";

console.log("📨 MAIL_ENABLED:", process.env.MAIL_ENABLED);
console.log("📧 MAIL_USER:", process.env.MAIL_USER);
console.log(
  "🔐 MAIL_PASS:",
  process.env.MAIL_PASS ? "✅ present" : "❌ missing",
);

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const port = Number(process.env.MAIL_PORT || 587);

  cachedTransporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || "smtp.gmail.com",
    port,
    secure:
      String(process.env.MAIL_SECURE).toLowerCase() ===
      "true",
    requireTLS: port === 587,
    name:
      process.env.MAIL_EHLO_NAME ||
      process.env.SMTP_EHLO_NAME ||
      "oatclub.in",
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
    pool: true,
    maxConnections: Number(
      process.env.MAIL_MAX_CONNECTIONS || 2,
    ),
    maxMessages: Number(
      process.env.MAIL_MAX_MESSAGES || 500,
    ),
  });

  cachedTransporter.verify((error) => {
    if (error) {
      console.error(
        "❌ SMTP verify failed:",
        error.message,
      );
    } else {
      console.log("✅ SMTP server ready to send emails");
    }
  });

  return cachedTransporter;
}

export async function sendMail({
  to,
  subject,
  text,
  html,
  headers = {},
}) {
  if (!MAIL_ENABLED) {
    console.log(
      "📭 MAIL_ENABLED false → skipping mail",
      { to, subject },
    );

    return { disabled: true };
  }

  if (!to) {
    throw new Error("Recipient email missing");
  }

  if (
    !process.env.MAIL_USER ||
    !process.env.MAIL_PASS
  ) {
    throw new Error(
      "MAIL_USER or MAIL_PASS missing in .env",
    );
  }

  const transporter = getTransporter();

  const from =
    process.env.MAIL_FROM ||
    `OATCLUB <${process.env.MAIL_USER}>`;

  const replyTo =
    process.env.MAIL_REPLY_TO ||
    process.env.MAIL_USER;

  const envelopeFrom =
    process.env.MAIL_ENVELOPE_FROM ||
    process.env.MAIL_USER;

  console.log("📤 Sending mail...", {
    to,
    subject,
    from,
    replyTo,
  });

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

const sendTemplate = (
  template,
  to,
  templateData,
  headers = {},
) => {
  const { subject, text, html } =
    template(templateData);

  return sendMail({
    to,
    subject,
    text,
    html,
    headers,
  });
};

export const Mailer = {
  sendUserOnboarding: ({
    to,
    name,
    ctaUrl,
    brandName,
    supportEmail,
  }) =>
    sendTemplate(userOnboardingTemplate, to, {
      name,
      ctaUrl,
      brandName,
      supportEmail,
    }),

  sendOrderConfirmation: ({
    to,
    name,
    order,
    ctaUrl,
  }) =>
    sendTemplate(orderConfirmationTemplate, to, {
      name,
      order,
      ctaUrl,
    }),

  sendOrderPaymentPending: ({
    to,
    name,
    order,
    paymentLink,
    expiresAt,
  }) =>
    sendTemplate(orderPaymentPendingTemplate, to, {
      name,
      order,
      paymentLink,
      expiresAt,
    }),

  sendOrderCancelled: ({
    to,
    name,
    order,
    ctaUrl,
    reason,
  }) =>
    sendTemplate(orderCancellationTemplate, to, {
      name,
      order,
      ctaUrl,
      reason,
    }),

  sendOrderCancellation: (payload) =>
    Mailer.sendOrderCancelled(payload),

  sendAdminOrderReceived: ({
    to,
    order,
    ctaUrl,
  }) =>
    sendTemplate(orderReceivedAdminTemplate, to, {
      order,
      ctaUrl,
    }),

  sendRmaCreated: ({
    to,
    name,
    order,
    rma,
    policy,
    ctaUrl,
  }) =>
    sendTemplate(rmaCreatedTemplate, to, {
      name,
      order,
      rma,
      policy,
      ctaUrl,
    }),

  sendRmaReversePickupBooked: ({
    to,
    name,
    orderNumber,
    rma,
    ctaUrl,
  }) =>
    sendTemplate(
      rmaReversePickupBookedTemplate,
      to,
      {
        name,
        orderNumber,
        rma,
        ctaUrl,
      },
      {
        "X-OATCLUB-Notification-Type":
          "rma-reverse-pickup-booked",
        "X-OATCLUB-RMA-Number": String(
          rma?.rmaNumber || "",
        ),
        "X-OATCLUB-Order-Number": String(
          orderNumber || "",
        ),
      },
    ),

  sendOrderTracking: ({
    to,
    name,
    awb,
    courierName,
    trackingLink,
    order,
    ctaUrl,
  }) =>
    sendTemplate(orderTrackingTemplate, to, {
      name,
      awb,
      courierName,
      trackingLink,
      order,
      ctaUrl,
    }),

  sendOrderShipped: ({
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

    return sendTemplate(orderShippedTemplate, to, {
      name,
      order: patchedOrder,
      ctaUrl,
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
    const {
      subject,
      text,
      html,
    } = orderTrackingTemplate({
      name,
      awb,
      courierName,
      trackingLink:
        trackingLink || ctaUrl,
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
        `Order Out for Delivery — #${order?.orderNumber ||
        order?._id ||
        ""
        }`,
      text,
      html,
    });
  },

  sendOrderDelivered: ({
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

    return sendTemplate(
      orderDeliveredTemplate,
      to,
      {
        name,
        order: patchedOrder,
        ctaUrl,
      },
    );
  },

  sendAdminUserTaskEmail: ({
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
  }) =>
    sendTemplate(
      adminUserTaskEmailTemplate,
      to,
      {
        eventType,
        task,
        recipient,
        actor,
        message,
        feedback,
        ctaUrl,
        brandName,
        supportEmail,
      },
      {
        "X-OATCLUB-Notification-Type":
          "admin-user-task",
        "X-OATCLUB-Task-Event":
          eventType || "task_updated",
        "X-OATCLUB-Task-Id": String(
          task?._id ||
          task?.taskNumber ||
          "",
        ),
      },
    ),

  sendCustomerCreditCredited: ({
    to,
    name,
    amount,
    balance,
    orderNumber,
    creditId,
    reason,
    creditedAt,
    ctaUrl,
  }) =>
    sendTemplate(
      customerCreditCreditedTemplate,
      to,
      {
        name,
        amount,
        balance,
        orderNumber,
        creditId,
        reason,
        creditedAt,
        ctaUrl,
      },
    ),
};

function patchShipment(
  order,
  awb,
  courierName,
  trackingLink,
) {
  return {
    ...(order || {}),
    shipment: {
      ...(order?.shipment || {}),
      shiprocket: {
        ...(order?.shipment?.shiprocket || {}),
        awb:
          awb ||
          order?.shipment?.shiprocket?.awb ||
          "",
        courierName:
          courierName ||
          order?.shipment?.shiprocket
            ?.courierName ||
          "",
        trackingUrl:
          trackingLink ||
          order?.shipment?.shiprocket
            ?.trackingUrl ||
          "",
      },
    },
  };
}
