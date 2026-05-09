import { Mailer } from "../nodemailer/events/mailer.js";
import User from "../Customer/Customer.js";

/**
 * ✅ Admin recipients
 */
const ADMIN_ORDER_ALERT_EMAILS = [
  "finance@mirayfashions.com",
  "support@mirayfashions.com",
].filter(Boolean);

/* ============================================================
   ✅ Helpers
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

const buildCustomerOrderCta = (orderId) => {
  const base = baseCustomerUrl();
  return orderId
    ? `${base}/profile/orders/${orderId}`
    : `${base}/profile/orders`;
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

const getCustomerDetailsFromOrder = (order) => {
  const shipping = order?.shippingAddressSnapshot || {};

  const email =
    order?.userSnapshot?.email ||
    order?.customer?.email ||
    order?.email ||
    shipping?.email ||
    "";

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

const getTrackingPayload = (order = {}) => {
  const awb =
    order?.shipment?.shiprocket?.awb ||
    order?.shipment?.xpressbees?.awb ||
    order?.trackingDetails?.trackingId ||
    "";

  const courierName =
    order?.shipment?.shiprocket?.courierName ||
    order?.shipment?.xpressbees?.courierName ||
    order?.trackingDetails?.courierName ||
    "Courier Partner";

  const trackingLink =
    order?.shipment?.shiprocket?.trackingUrl ||
    order?.shipment?.xpressbees?.trackingUrl ||
    order?.trackingDetails?.trackingUrl ||
    "";

  return { awb, courierName, trackingLink };
};

const fetchCustomerFallback = async (order, customerName = "Customer") => {
  let { email, name } = getCustomerDetailsFromOrder(order);

  if (!email && order?.customerId) {
    try {
      const user = await User.findById(order.customerId).lean();

      if (user?.email) email = String(user.email).trim().toLowerCase();
      if (user?.name) name = String(user.name).trim();
    } catch (e) {
      console.log("⚠️ Could not fetch user for email fallback:", e?.message);
    }
  }

  return {
    email,
    name: name || customerName,
  };
};

/* ============================================================
   ✅ ORDER CREATED EMAILS
============================================================ */

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

export async function sendCustomerOrderConfirmationMail(order) {
  try {
    if (!isMailEnabled()) return;

    const { email, name } = await fetchCustomerFallback(order);

    if (!email) {
      console.log("📭 Customer confirmation skipped: email missing", {
        orderId: order?._id,
        customerId: order?.customerId,
      });
      return;
    }

    const orderId = buildOrderId(order);
    const ctaUrl = buildCustomerOrderCta(orderId);

    await Mailer.sendOrderConfirmation({
      to: email,
      name,
      order,
      ctaUrl,
    });

    console.log("✅ Customer confirmation mail sent:", email);
  } catch (err) {
    console.error("❌ Customer confirmation mail error:", err);
  }
}

export function triggerOrderEmails(order) {
  try {
    sendAdminOrderReceivedMail(order).catch((e) =>
      console.error("❌ Admin order received trigger error:", e?.message || e)
    );

    sendCustomerOrderConfirmationMail(order).catch((e) =>
      console.error("❌ Customer confirmation trigger error:", e?.message || e)
    );
  } catch (e) {
    console.error("⚠️ triggerOrderEmails failed:", e);
  }
}

/* ============================================================
   ✅ CANCELLATION EMAILS
============================================================ */

export async function sendCustomerOrderCancelledMail(order, reason = "") {
  try {
    if (!isMailEnabled()) return;

    const { email, name } = await fetchCustomerFallback(order);

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

export function triggerOrderCancellationEmails(order, reason = "") {
  try {
    sendCustomerOrderCancelledMail(order, reason).catch((e) =>
      console.error("❌ Customer cancellation trigger error:", e?.message || e)
    );

    sendAdminOrderCancelledMail(order, reason).catch((e) =>
      console.error("❌ Admin cancellation trigger error:", e?.message || e)
    );
  } catch (e) {
    console.error("⚠️ triggerOrderCancellationEmails failed:", e);
  }
}

/* ============================================================
   ✅ FULFILLMENT EMAILS
   supported:
   - shipped
   - out_for_delivery
   - delivered
============================================================ */

export async function sendCustomerOrderShippedMail(order) {
  try {
    if (!isMailEnabled()) return;

    const { email, name } = await fetchCustomerFallback(order);
    if (!email) {
      console.log("📭 Customer shipped mail skipped: email missing");
      return;
    }

    const orderId = buildOrderId(order);
    const ctaUrl = buildCustomerOrderCta(orderId);
    const { awb, courierName, trackingLink } = getTrackingPayload(order);

    await Mailer.sendOrderShipped({
      to: email,
      name,
      order,
      ctaUrl,
      awb,
      courierName,
      trackingLink: trackingLink || ctaUrl,
    });

    console.log("✅ Customer shipped mail sent:", email);
  } catch (err) {
    console.error("❌ Customer shipped mail error:", err);
  }
}

export async function sendCustomerOrderOutForDeliveryMail(order) {
  try {
    if (!isMailEnabled()) return;

    const { email, name } = await fetchCustomerFallback(order);
    if (!email) {
      console.log("📭 Customer OFD mail skipped: email missing");
      return;
    }

    const orderId = buildOrderId(order);
    const ctaUrl = buildCustomerOrderCta(orderId);
    const { awb, courierName, trackingLink } = getTrackingPayload(order);

    // ✅ If mailer has dedicated OFD method use it, else fallback to tracking template
    const sendFn =
      typeof Mailer.sendOrderOutForDelivery === "function"
        ? Mailer.sendOrderOutForDelivery
        : Mailer.sendOrderTracking;

    await sendFn({
      to: email,
      name,
      order: {
        ...order,
        emailStatusLabel: "Out for Delivery",
      },
      ctaUrl,
      awb,
      courierName,
      trackingLink: trackingLink || ctaUrl,
    });

    console.log("✅ Customer out-for-delivery mail sent:", email);
  } catch (err) {
    console.error("❌ Customer out-for-delivery mail error:", err);
  }
}

export async function sendCustomerOrderDeliveredMail(order) {
  try {
    if (!isMailEnabled()) return;

    const { email, name } = await fetchCustomerFallback(order);
    if (!email) {
      console.log("📭 Customer delivered mail skipped: email missing");
      return;
    }

    const orderId = buildOrderId(order);
    const ctaUrl = buildCustomerOrderCta(orderId);
    const { awb, courierName, trackingLink } = getTrackingPayload(order);

    await Mailer.sendOrderDelivered({
      to: email,
      name,
      order,
      ctaUrl,
      awb,
      courierName,
      trackingLink: trackingLink || ctaUrl,
    });

    console.log("✅ Customer delivered mail sent:", email);
  } catch (err) {
    console.error("❌ Customer delivered mail error:", err);
  }
}

/**
 * ✅ Unified fulfillment trigger
 * Call this after status update/save/sync/webhook:
 *
 * triggerFulfillmentStatusEmail(updatedOrder, "shipped")
 * triggerFulfillmentStatusEmail(updatedOrder, "out_for_delivery")
 * triggerFulfillmentStatusEmail(updatedOrder, "delivered")
 */
export function triggerFulfillmentStatusEmail(order, status) {
  try {
    const normalizedStatus = String(
      status || order?.fulfillmentStatus || ""
    )
      .trim()
      .toLowerCase();

    console.log("📦 Fulfillment email trigger check:", {
      orderNumber: order?.orderNumber,
      status: normalizedStatus,
    });

    if (normalizedStatus === "shipped") {
      sendCustomerOrderShippedMail(order).catch((e) =>
        console.error("❌ Shipped email trigger error:", e?.message || e)
      );
      return;
    }

    if (normalizedStatus === "out_for_delivery") {
      sendCustomerOrderOutForDeliveryMail(order).catch((e) =>
        console.error("❌ OFD email trigger error:", e?.message || e)
      );
      return;
    }

    if (normalizedStatus === "delivered") {
      sendCustomerOrderDeliveredMail(order).catch((e) =>
        console.error("❌ Delivered email trigger error:", e?.message || e)
      );
      return;
    }

    console.log("📭 No fulfillment email mapped for status:", normalizedStatus);
  } catch (e) {
    console.error("⚠️ triggerFulfillmentStatusEmail failed:", e);
  }
}

/* ============================================================
   ✅ RMA EMAILS
============================================================ */

export async function sendCustomerRmaCreatedMail({
  order,
  rma,
  policy = { windowDays: 7 },
}) {
  try {
    if (!isMailEnabled()) return;

    const { email, name } = await fetchCustomerFallback(order);

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

export function triggerRmaEmails({ order, rma, policy }) {
  try {
    console.log("📩 Triggering RMA emails...", {
      orderNumber: order?.orderNumber,
      rmaNumber: rma?.rmaNumber,
      policyDays: policy?.windowDays,
    });

    sendCustomerRmaCreatedMail({
      order,
      rma,
      policy: policy || { windowDays: 7 },
    }).catch((e) =>
      console.error("❌ Customer RMA trigger error:", e?.message || e)
    );

    sendAdminRmaCreatedMail({
      order,
      rma,
      policy: policy || { windowDays: 7 },
    }).catch((e) =>
      console.error("❌ Admin RMA trigger error:", e?.message || e)
    );
  } catch (e) {
    console.error("⚠️ triggerRmaEmails failed:", e);
  }
}