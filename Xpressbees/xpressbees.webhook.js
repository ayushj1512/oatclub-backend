// Xpressbees/xpressbees.webhook.js

import crypto from "crypto";
import Order from "../Orders/Orders.js"; // <-- CHANGE PATH as per your project

import { mapXpressbeesStatus } from "./xpressbees.statusMap.js";

/**
 * CONFIG (keep server-side only)
 * - XPRESSBEES_WEBHOOK_SECRET: shared secret for signature/token verification
 * - XPRESSBEES_WEBHOOK_MODE: "hmac" | "token" (default: token)
 *
 * NOTE: In Next.js, do NOT expose these with NEXT_PUBLIC_
 */
const WEBHOOK_SECRET = process.env.XPRESSBEES_WEBHOOK_SECRET || "";
const WEBHOOK_MODE = (process.env.XPRESSBEES_WEBHOOK_MODE || "token").toLowerCase();

/**
 * Try to extract AWB & status code from webhook payload.
 * Since exact payload format may vary by account, we support multiple key possibilities.
 */
export function extractWebhookFields(payload = {}) {
  const awb =
    payload?.awb ||
    payload?.awb_number ||
    payload?.waybill ||
    payload?.tracking_number ||
    payload?.trackingId ||
    payload?.data?.awb ||
    payload?.data?.awb_number ||
    payload?.data?.waybill ||
    "";

  const statusCode =
    payload?.status_code ||
    payload?.current_status_code ||
    payload?.status ||
    payload?.event_code ||
    payload?.data?.status_code ||
    payload?.data?.current_status_code ||
    payload?.data?.status ||
    "";

  // Optional details
  const message =
    payload?.message ||
    payload?.status_description ||
    payload?.event_description ||
    payload?.data?.message ||
    payload?.data?.status_description ||
    "";

  const location =
    payload?.location ||
    payload?.event_location ||
    payload?.data?.location ||
    payload?.data?.event_location ||
    "";

  const eventTime =
    payload?.event_time ||
    payload?.scan_time ||
    payload?.timestamp ||
    payload?.data?.event_time ||
    payload?.data?.scan_time ||
    payload?.data?.timestamp ||
    null;

  return { awb: String(awb).trim(), statusCode: String(statusCode).trim(), message, location, eventTime };
}

/**
 * MODE A: HMAC verification
 * You will need to align:
 * - signature header name
 * - exact signed string (raw body) and algorithm
 *
 * This implementation expects header:
 *   x-xpressbees-signature: hex(hmac_sha256(rawBody, secret))
 */
export function verifyHmacSignature({ rawBody, signature }) {
  if (!WEBHOOK_SECRET) return { ok: false, reason: "WEBHOOK_SECRET not set" };
  if (!signature) return { ok: false, reason: "signature missing" };

  const computed = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody, "utf8")
    .digest("hex");

  const sig = String(signature).trim();

  // timing-safe compare
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "signature length mismatch" };

  const match = crypto.timingSafeEqual(a, b);
  return match ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

/**
 * MODE B: Token verification
 * Accept header `x-webhook-token` == secret
 */
export function verifyToken({ token }) {
  if (!WEBHOOK_SECRET) return { ok: false, reason: "WEBHOOK_SECRET not set" };
  if (!token) return { ok: false, reason: "token missing" };
  return String(token).trim() === WEBHOOK_SECRET
    ? { ok: true }
    : { ok: false, reason: "token mismatch" };
}

/**
 * Update order by AWB:
 * - set provider xpressbees
 * - update shipment.status + fulfillmentStatus
 * - set timestamps for delivered
 * - store last webhook payload for auditing/debug
 */
export async function handleXpressbeesWebhook({ payload, rawBody, headers = {} }) {
  // 1) Verify security
  if (WEBHOOK_MODE === "hmac") {
    const signature =
      headers["x-xpressbees-signature"] ||
      headers["xpressbees-signature"] ||
      headers["x-signature"] ||
      "";
    const ver = verifyHmacSignature({ rawBody, signature });
    if (!ver.ok) {
      return { ok: false, status: 401, message: `Unauthorized (HMAC): ${ver.reason}` };
    }
  } else {
    // token mode default
    const token = headers["x-webhook-token"] || headers["xpressbees-token"] || "";
    const ver = verifyToken({ token });
    if (!ver.ok) {
      return { ok: false, status: 401, message: `Unauthorized (TOKEN): ${ver.reason}` };
    }
  }

  // 2) Parse fields
  const { awb, statusCode, message, location, eventTime } = extractWebhookFields(payload);
  if (!awb) return { ok: false, status: 400, message: "AWB missing in webhook payload" };

  // 3) Find order by AWB (prefer xpressbees path; fallback trackingDetails)
  const order =
    (await Order.findOne({ "shipment.xpressbees.awb": awb })) ||
    (await Order.findOne({ "trackingDetails.trackingId": awb }));

  if (!order) {
    // Not fatal; maybe order not created yet. Log in your server logs.
    return { ok: true, status: 200, message: "Order not found for AWB (ignored)", awb };
  }

  // 4) Map status & update
  const mapped = mapXpressbeesStatus(statusCode);

  order.shipment = order.shipment || {};
  order.shipment.provider = "xpressbees";
  order.shipment.status = mapped.shipmentStatus;

  order.fulfillmentStatus = mapped.fulfillmentStatus;

  order.trackingDetails = order.trackingDetails || {};
  order.trackingDetails.trackingId = awb;
  order.trackingDetails.courierName = "XpressBees";

  // timestamps
  if (mapped.shipmentStatus === "shipped" && !order.shipment.shippedAt) {
    order.shipment.shippedAt = new Date();
    order.trackingDetails.shippedAt = order.trackingDetails.shippedAt || new Date();
  }

  if (mapped.shipmentStatus === "delivered") {
    order.shipment.deliveredAt = order.shipment.deliveredAt || new Date();
    order.trackingDetails.deliveredAt = order.trackingDetails.deliveredAt || new Date();
  }

  // audit/debug: store last webhook snapshot
  order.shipment.xpressbees = order.shipment.xpressbees || {};
  order.shipment.xpressbees.lastWebhook = {
    receivedAt: new Date(),
    statusCode: statusCode || "",
    message: message || "",
    location: location || "",
    eventTime: eventTime || null,
    payload,
  };

  await order.save();

  return {
    ok: true,
    status: 200,
    message: "Webhook processed",
    awb,
    statusCode,
    mapped,
    orderId: String(order._id),
  };
}
