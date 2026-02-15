import { Mailer } from "../nodemailer/events/mailer.js";
import User from "../Customer/Customer.js"; // ✅ adjust path if your User model is somewhere else

/**
 * ✅ Admin recipients (hardcoded now)
 * Later you can move to .env ADMIN_ORDER_EMAILS if you want
 */
const ADMIN_ORDER_ALERT_EMAILS = [
  "finance@mirayfashions.com",
  "support@mirayfashions.com",
].filter(Boolean);

/* ============================================================
   ✅ Helpers (safe)
============================================================ */

const uniqLower = (arr) =>
  [
    ...new Set(
      (arr || [])
        .map((x) => String(x || "").trim().toLowerCase())
        .filter(Boolean)
    ),
  ].filter(Boolean);

const buildOrderId = (order) =>
  String(order?.orderId || order?.orderNumber || order?._id || "");

const buildRmaId = (rma) => String(rma?.rmaNumber || rma?._id || "");

const baseAdminUrl = () =>
  process.env.ADMIN_PANEL_URL ||
  process.env.CLIENT_URL ||
  "http://localhost:3000";

const baseCustomerUrl = () =>
  process.env.CLIENT_URL || "http://localhost:3000";

const buildAdminOrderCta = (orderId) => {
  const base = baseAdminUrl();
  return orderId ? `${base}/admin/orders/${orderId}` : base;
};

/**
 * ✅ Customer order CTA
 * ✅ Updated: /profile/orders
 */
const buildCustomerOrderCta = (orderId) => {
  const base = baseCustomerUrl();
  return orderId ? `${base}/profile/orders/${orderId}` : `${base}/profile/orders`;
};

const buildAdminRmaCta = (orderId, rmaId) => {
  const base = baseAdminUrl();
  if (orderId && rmaId) return `${base}/admin/orders/${orderId}?rma=${rmaId}`;
  if (orderId) return `${base}/admin/orders/${orderId}`;
  return base;
};

const buildCustomerRmaCta = (orderId, rmaId) => {
  const base = baseCustomerUrl();
  if (orderId && rmaId) return `${base}/profile/orders/${orderId}?rma=${rmaId}`;
  if (orderId) return `${base}/profile/orders/${orderId}`;
  return `${base}/profile/orders`;
};

const isMailEnabled = () => process.env.MAIL_ENABLED === "true";

/**
 * ✅ Customer details helper (with safe fallbacks)
 */
const getCustomerDetailsFromOrder = (order) => {
  const shipping = order?.shippingAddressSnapshot || {};

  const email =
    order?.userSnapshot?.email ||
    order?.customer?.email ||
    order?.email ||
    shipping?.email ||
    "";

  // ✅ SHIPPING NAME FIX: fullName / name / firstName-lastName
  const shippingName =
    shipping?.fullName ||
    shipping?.name ||
    [shipping?.firstName, shipping?.lastName].filter(Boolean).join(" ") ||
    "";

  const name =
    shippingName ||
    order?.userSnapshot?.name ||
    order?.customer?.name ||
    "Customer";

  return {
    email: String(email || "").trim().toLowerCase(),
    name: String(name || "Customer").trim(),
  };
};

/* ============================================================
   ✅ ORDER EMAILS
============================================================ */

/**
 * ✅ Send admin "order received" emails
 */
export async function sendAdminOrderReceivedMail(order) {
  try {
    if (!isMailEnabled()) return;

    const recipients = uniqLower(ADMIN_ORDER_ALERT_EMAILS);
    if (!recipients.length) return;

    const orderId = buildOrderId(order);
    const ctaUrl = buildAdminOrderCta(orderId);

    await Mailer.sendAdminOrderReceived({
      to: recipients.join(","),
      order,
      ctaUrl,
    });

    console.log("✅ Admin order received mail sent:", recipients.join(", "));
  } catch (err) {
    console.error("❌ Admin order received mail error:", err);
  }
}

/**
 * ✅ Send customer order confirmation email
 */
export async function sendCustomerOrderConfirmationMail(order) {
  try {
    if (!isMailEnabled()) return;

    let { email: customerEmail, name: customerName } =
      getCustomerDetailsFromOrder(order);

    // ✅ fallback: fetch user if email missing
    if (!customerEmail && order?.customerId) {
      try {
        const user = await User.findById(order.customerId).lean();
        if (user?.email) customerEmail = String(user.email).trim().toLowerCase();
        if (user?.name) customerName = String(user.name).trim();
      } catch (e) {
        console.log("⚠️ Could not fetch user for confirmation email");
      }
    }

    if (!customerEmail) {
      console.log("📭 Customer confirmation skipped: email missing", {
        orderId: order?._id,
        customerId: order?.customerId,
      });
      return;
    }

    const orderId = buildOrderId(order);
    const ctaUrl = buildCustomerOrderCta(orderId);

    await Mailer.sendOrderConfirmation({
      to: customerEmail,
      name: customerName,
      order,
      ctaUrl,
    });

    console.log("✅ Customer confirmation mail sent:", customerEmail);
  } catch (err) {
    console.error("❌ Customer confirmation mail error:", err);
  }
}

/**
 * ✅ Unified: order created trigger (Admin + Customer)
 */
export function triggerOrderEmails(order) {
  try {
    sendAdminOrderReceivedMail(order);
    sendCustomerOrderConfirmationMail(order);
  } catch (e) {
    console.error("⚠️ triggerOrderEmails failed:", e);
  }
}

/* ============================================================
   ✅ ORDER CANCELLATION EMAILS
============================================================ */

/**
 * ✅ Customer order cancellation email
 */
export async function sendCustomerOrderCancelledMail(order, reason = "") {
  try {
    if (!isMailEnabled()) return;

    const { email, name } = getCustomerDetailsFromOrder(order);
    if (!email) {
      console.log("📭 Customer cancellation skipped: email missing");
      return;
    }

    const orderId = buildOrderId(order);
    const ctaUrl = buildCustomerOrderCta(orderId);

    await Mailer.sendOrderCancelled({
      to: email,
      name,
      order,
      ctaUrl,
      reason,
    });

    console.log("✅ Customer order cancelled mail sent:", email);
  } catch (err) {
    console.error("❌ Customer order cancelled mail error:", err);
  }
}

/**
 * ✅ Admin cancellation mail (optional)
 */
export async function sendAdminOrderCancelledMail(order, reason = "") {
  try {
    if (!isMailEnabled()) return;

    const recipients = uniqLower(ADMIN_ORDER_ALERT_EMAILS);
    if (!recipients.length) return;

    const orderId = buildOrderId(order);
    const ctaUrl = buildAdminOrderCta(orderId);

    await Mailer.sendOrderCancelled({
      to: recipients.join(","),
      name: "Admin",
      order,
      ctaUrl,
      reason,
    });

    console.log("✅ Admin order cancelled mail sent:", recipients.join(", "));
  } catch (err) {
    console.error("❌ Admin order cancelled mail error:", err);
  }
}

/**
 * ✅ Unified trigger: Cancellation (Admin + Customer)
 */
export function triggerOrderCancellationEmails(order, reason = "") {
  try {
    sendCustomerOrderCancelledMail(order, reason);
    sendAdminOrderCancelledMail(order, reason);
  } catch (e) {
    console.error("⚠️ triggerOrderCancellationEmails failed:", e);
  }
}

/* ============================================================
   ✅ RMA EMAILS
============================================================ */

/**
 * ✅ Customer RMA created mail
 */
export async function sendCustomerRmaCreatedMail({
  order,
  rma,
  policy = { windowDays: 7 },
}) {
  try {
    if (!isMailEnabled()) return;

    const { email, name } = getCustomerDetailsFromOrder(order);
    if (!email) {
      console.log("📭 Customer RMA mail skipped: email missing");
      return;
    }

    const orderId = buildOrderId(order);
    const rmaId = buildRmaId(rma);
    const ctaUrl = buildCustomerRmaCta(orderId, rmaId);

    console.log("📩 Sending CUSTOMER RMA mail...", {
      orderNumber: order?.orderNumber,
      rmaNumber: rma?.rmaNumber,
      to: email,
    });

    await Mailer.sendRmaCreated({
      to: email,
      name,
      order,
      rma,
      policy,
      ctaUrl,
    });

    console.log("✅ Customer RMA created mail sent:", email);
  } catch (err) {
    console.error("❌ Customer RMA created mail error:", err);
  }
}

/**
 * ✅ Admin RMA created mail
 */
export async function sendAdminRmaCreatedMail({
  order,
  rma,
  policy = { windowDays: 7 },
}) {
  try {
    if (!isMailEnabled()) return;

    const recipients = uniqLower(ADMIN_ORDER_ALERT_EMAILS);
    if (!recipients.length) return;

    const orderId = buildOrderId(order);
    const rmaId = buildRmaId(rma);
    const ctaUrl = buildAdminRmaCta(orderId, rmaId);

    console.log("📩 Sending ADMIN RMA mail...", {
      orderNumber: order?.orderNumber,
      rmaNumber: rma?.rmaNumber,
      to: recipients.join(","),
    });

    await Mailer.sendRmaCreated({
      to: recipients.join(","),
      name: "Admin",
      order,
      rma,
      policy,
      ctaUrl,
    });

    console.log("✅ Admin RMA created mail sent:", recipients.join(", "));
  } catch (err) {
    console.error("❌ Admin RMA created mail error:", err);
  }
}

/**
 * ✅ Unified trigger: RMA created mail
 */
export function triggerRmaEmails({ order, rma, policy }) {
  try {
    console.log("📩 Triggering RMA emails...", {
      orderNumber: order?.orderNumber,
      rmaNumber: rma?.rmaNumber,
      policyDays: policy?.windowDays,
    });

    sendCustomerRmaCreatedMail({ order, rma, policy: policy || { windowDays: 7 } });
    sendAdminRmaCreatedMail({ order, rma, policy: policy || { windowDays: 7 } });
  } catch (e) {
    console.error("⚠️ triggerRmaEmails failed:", e);
  }
}
