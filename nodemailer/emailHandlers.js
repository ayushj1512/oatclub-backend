// nodemailer/emailHandlers.js

import { EVENTS, eventBus } from "./eventBus.js";
import { sendMail } from "./mailer.js";

// ✅ Import all templates (ESM)
import { onboardingTemplate } from "./OnboardingEmailTempalte.js";
import { orderConfirmationTemplate } from "./OrderConfirmationTemplate.js";
import { orderReceivedTemplate } from "./OrderReceivedTemplate.js";
import { rmaCreatedTemplate } from "./events/RmaEmailTemplate.js";

// ✅ Fixed recipients for ORDER_RECEIVED (NO .env)
const ORDER_RECEIVED_RECIPIENTS = [
  "finance@mirayfashions.com",
  "admin@mirayfashions.com",
];

/* =========================================================
   ✅ USER REGISTERED → Onboarding Email (Customer)
   event payload:
   { email, name, ctaUrl? }
========================================================= */
eventBus.on(EVENTS.USER_REGISTERED, async ({ email, name, ctaUrl }) => {
  try {
    if (!email) throw new Error("Missing email in USER_REGISTERED event");

    const { subject, text, html } = onboardingTemplate({
      name,
      ctaUrl: ctaUrl || "https://mirayfashions.com",
    });

    await sendMail({ to: email, subject, text, html });

    console.log("✅ USER_REGISTERED onboarding email sent to:", email);
  } catch (err) {
    console.error("❌ USER_REGISTERED email failed:", err.message);
  }
});

/* =========================================================
   ✅ ORDER CONFIRMED → Order Confirmation Email (Customer)
   event payload:
   { email, name, order, ctaUrl? }
========================================================= */
eventBus.on(EVENTS.ORDER_CONFIRMED, async ({ email, name, order, ctaUrl }) => {
  try {
    if (!email) throw new Error("Missing email in ORDER_CONFIRMED event");
    if (!order) throw new Error("Missing order in ORDER_CONFIRMED event");

    const { subject, text, html } = orderConfirmationTemplate({
      name,
      order,
      ctaUrl: ctaUrl || "https://mirayfashions.com/account/orders",
    });

    await sendMail({ to: email, subject, text, html });

    console.log("✅ ORDER_CONFIRMED email sent to:", email);
  } catch (err) {
    console.error("❌ ORDER_CONFIRMED email failed:", err.message);
  }
});

/* =========================================================
   ✅ ORDER RECEIVED → Stakeholders Email (Finance + Admin)
   event payload:
   { order }
========================================================= */
eventBus.on(EVENTS.ORDER_RECEIVED, async ({ order }) => {
  try {
    if (!order) throw new Error("Missing order in ORDER_RECEIVED event");

    const { subject, text, html } = orderReceivedTemplate({
      order,
    });

    await sendMail({
      to: ORDER_RECEIVED_RECIPIENTS, // ✅ ONLY these two
      subject,
      text,
      html,
    });

    console.log(
      "✅ ORDER_RECEIVED email sent to finance + admin:",
      order?.orderNumber || order?._id
    );
  } catch (err) {
    console.error("❌ ORDER_RECEIVED email failed:", err.message);
  }
});

/* =========================================================
   ✅ RMA REQUESTED → RMA Created Email (Customer)
   event payload:
   { email, name, order, rma, policy, ctaUrl? }
========================================================= */
eventBus.on(EVENTS.RMA_REQUESTED, async ({ email, name, order, rma, policy, ctaUrl }) => {
  try {
    if (!email) throw new Error("Missing email in RMA_REQUESTED event");
    if (!order) throw new Error("Missing order in RMA_REQUESTED event");
    if (!rma) throw new Error("Missing rma in RMA_REQUESTED event");

    const { subject, text, html } = rmaCreatedTemplate({
      name,
      order,
      rma,
      policy,
      ctaUrl: ctaUrl || "https://mirayfashions.com/account/rma",
    });

    await sendMail({ to: email, subject, text, html });

    console.log("✅ RMA_REQUESTED email sent to:", email);
  } catch (err) {
    console.error("❌ RMA_REQUESTED email failed:", err.message);
  }
});

console.log("✅ Email handlers registered (templates wired).");
