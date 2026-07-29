// shiprocket/shiprocket.webhook.js

import Order from "../Orders/Orders.js";
import { triggerFulfillmentStatusEmail } from "../Orders/order.emails.js";

const SHIPROCKET_WEBHOOK_TOKEN = process.env.SHIPROCKET_WEBHOOK_TOKEN || "";

const safeStr = (value) =>
  value === undefined || value === null ? "" : String(value).trim();

const normalizeStatus = (value = "") =>
  safeStr(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/**
 * shipmentStatus:
 * Stored inside order.shipment.status.
 *
 * fulfillmentStatus:
 * Stored inside order.fulfillmentStatus.
 *
 * OATCLUB requirement:
 * As soon as shipment is booked/AWB assigned,
 * fulfilment status should become "shipped".
 */
const STATUS_MAP = {
  NEW: "shipped",
  READY_TO_SHIP: "shipped",
  AWB_ASSIGNED: "shipped",
  SHIPMENT_BOOKED: "shipped",
  PICKUP_SCHEDULED: "shipped",

  PICKED_UP: "shipped",
  SHIPMENT_PICKED_UP: "shipped",

  SHIPPED: "shipped",
  SHIPMENT_SHIPPED: "shipped",
  IN_TRANSIT: "shipped",
  SHIPMENT_IN_TRANSIT: "shipped",

  OUT_FOR_DELIVERY: "out_for_delivery",
  SHIPMENT_OUT_FOR_DELIVERY: "out_for_delivery",

  DELIVERED: "delivered",
  SHIPMENT_DELIVERED: "delivered",

  RTO_INITIATED: "rto",
  RTO_IN_TRANSIT: "rto",
  RTO_DELIVERED: "rto",

  CANCELLED: "cancelled",
  CANCELED: "cancelled",
  SHIPMENT_CANCELLED: "cancelled",

  LOST: "failed",
  DAMAGED: "failed",
};

const getRawStatus = (data = {}) =>
  safeStr(
    data.current_status ||
      data.shipment_status ||
      data.current_status_name ||
      data.status ||
      data.status_name,
  );

const getStatusCode = (data = {}) =>
  safeStr(
    data.current_status_id ||
      data.shipment_status_id ||
      data.status_code ||
      data.status_id,
  );

const getAwb = (data = {}) =>
  safeStr(data.awb || data.awb_code || data.awb_number || data.tracking_number);

const getShipmentId = (data = {}) =>
  safeStr(data.shipment_id || data.shipmentId || data.sr_shipment_id);

const getShiprocketOrderId = (data = {}) =>
  safeStr(
    data.sr_order_id || data.shiprocket_order_id || data.shiprocketOrderId,
  );

const getChannelOrderNumber = (data = {}) =>
  safeStr(
    data.channel_order_id || data.channel_order_number || data.order_number,
  );

const getCourierName = (data = {}) =>
  safeStr(
    data.courier_name ||
      data.courier ||
      data.courier_company_name ||
      data.shipping_provider,
  );

const getTrackingUrl = (data = {}, awb = "") =>
  safeStr(
    data.tracking_url ||
      data.track_url ||
      data.tracking_link ||
      data.track_link,
  ) || (awb ? `https://shiprocket.co/tracking/${encodeURIComponent(awb)}` : "");

const getLabelUrl = (data = {}) =>
  safeStr(data.label_url || data.label || data.shipping_label_url);

const verifyWebhookToken = (req) => {
  if (!SHIPROCKET_WEBHOOK_TOKEN) return true;

  const token = safeStr(
    req.header("x-api-key") ||
      req.header("anx-api-key") ||
      req.header("authorization"),
  ).replace(/^Bearer\s+/i, "");

  return token === SHIPROCKET_WEBHOOK_TOKEN;
};

const toDate = (value) => {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const str = safeStr(value);

  // Example: 29 07 2026 14:30:00
  const spacedDateMatch = str.match(/^(\d{2})\s+(\d{2})\s+(\d{4})\s+(.+)$/);

  if (spacedDateMatch) {
    const [, dd, mm, yyyy, time] = spacedDateMatch;
    const parsed = new Date(`${yyyy}-${mm}-${dd}T${time}`);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(
    str.includes(" ") && !str.includes("T") ? str.replace(" ", "T") : str,
  );

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getExpectedDelivery = (data = {}) =>
  toDate(data.expected_delivery_date || data.expected_delivery || data.etd);

const getWebhookDate = (data = {}) =>
  toDate(
    data.current_timestamp ||
      data.updated_at ||
      data.created_at ||
      data.timestamp,
  ) || new Date();

const normalizeOrderNumberCandidates = (value) => {
  const original = safeStr(value);

  if (!original) return [];

  const withoutHash = original.replace(/^#+/, "").trim();
  const withoutShopPrefix = withoutHash.replace(/^SHOP[-_\s]*/i, "").trim();

  const candidates = new Set([original, withoutHash, withoutShopPrefix]);

  if (withoutShopPrefix) {
    candidates.add(`SHOP-${withoutShopPrefix}`);
  }

  const numeric = withoutShopPrefix.replace(/\D/g, "");

  if (numeric) {
    candidates.add(numeric);
    candidates.add(numeric.padStart(6, "0"));
    candidates.add(`SHOP-${numeric}`);
    candidates.add(`SHOP-${numeric.padStart(4, "0")}`);
  }

  return [...candidates].filter(Boolean);
};

const findOrderFromWebhook = async ({
  awb,
  shipmentId,
  shiprocketOrderId,
  channelOrderNumber,
}) => {
  const matchers = [];

  if (awb) {
    matchers.push(
      { "shipment.awb": awb },
      { "shipment.shiprocket.awb": awb },
      { "trackingDetails.awb": awb },
      { "trackingDetails.trackingId": awb },
    );
  }

  if (shipmentId) {
    matchers.push(
      { "shipment.shipmentId": shipmentId },
      { "shipment.shiprocket.shipmentId": shipmentId },
    );
  }

  if (shiprocketOrderId) {
    matchers.push(
      { "shipment.orderId": shiprocketOrderId },
      { "shipment.shiprocket.orderId": shiprocketOrderId },
    );
  }

  const orderNumberCandidates =
    normalizeOrderNumberCandidates(channelOrderNumber);

  if (orderNumberCandidates.length) {
    matchers.push({
      orderNumber: { $in: orderNumberCandidates },
    });
  }

  if (!matchers.length) return null;

  return Order.findOne({ $or: matchers });
};

const triggerWebhookEmailSafe = (order, nextStatus) => {
  try {
    Promise.resolve(
      triggerFulfillmentStatusEmail(
        order?.toObject ? order.toObject() : order,
        nextStatus,
      ),
    ).catch((error) => {
      console.error(
        "⚠️ Shiprocket webhook email trigger failed:",
        error?.message || error,
      );
    });
  } catch (error) {
    console.error(
      "⚠️ Shiprocket webhook email trigger failed:",
      error?.message || error,
    );
  }
};

const setDateIfMissing = (object, field, value) => {
  if (!object[field]) {
    object[field] = value;
  }
};

export async function shiprocketWebhook(req, res) {
  try {
    console.log("🚨 [SHIPROCKET-WEBHOOK] TRIGGERED", {
      method: req.method,
      url: req.originalUrl,
      receivedAt: new Date().toISOString(),
      headers: {
        "x-api-key": req.header("x-api-key") ? "present" : "missing",
        "anx-api-key": req.header("anx-api-key") ? "present" : "missing",
        authorization: req.header("authorization") ? "present" : "missing",
        "content-type": req.header("content-type"),
      },
      body: req.body,
    });

    if (!verifyWebhookToken(req)) {
      console.warn("⚠️ [SHIPROCKET-WEBHOOK] INVALID TOKEN", {
        receivedAt: new Date().toISOString(),
        tokenConfigured: Boolean(SHIPROCKET_WEBHOOK_TOKEN),
      });

      return res.status(200).json({
        success: true,
        ignored: true,
        reason: "invalid_token",
      });
    }

    console.log("✅ [SHIPROCKET-WEBHOOK] TOKEN VERIFIED");

    const data = req.body || {};
    const now = new Date();
    const webhookDate = getWebhookDate(data);

    const awb = getAwb(data);
    const shipmentId = getShipmentId(data);
    const channelOrderNumber = getChannelOrderNumber(data);
    const shiprocketOrderId = getShiprocketOrderId(data);

    const courierName = getCourierName(data);
    const trackingUrl = getTrackingUrl(data, awb);
    const labelUrl = getLabelUrl(data);

    const rawStatus = getRawStatus(data);
    const normalizedStatus = normalizeStatus(rawStatus);
    const statusCode = getStatusCode(data);

    const mappedStatus = STATUS_MAP[normalizedStatus] || null;
    console.log("📦 [SHIPROCKET-WEBHOOK] PARSED", {
      awb,
      shipmentId,
      shiprocketOrderId,
      channelOrderNumber,
      courierName,
      trackingUrl,
      rawStatus,
      normalizedStatus,
      statusCode,
      mappedStatus,
    });
    /**
     * Even when status is unknown, continue processing if tracking,
     * AWB or courier information is present.
     *
     * This is necessary for courier reassignment webhooks.
     */
    if (
      !mappedStatus &&
      !awb &&
      !shipmentId &&
      !shiprocketOrderId &&
      !courierName &&
      !trackingUrl
    ) {
      return res.status(200).json({
        success: true,
        ignored: true,
        reason: "No usable shipment information",
      });
    }

    console.log("🔍 [SHIPROCKET-WEBHOOK] FINDING ORDER", {
      awb,
      shipmentId,
      shiprocketOrderId,
      channelOrderNumber,
    });

    const order = await findOrderFromWebhook({
      awb,
      shipmentId,
      shiprocketOrderId,
      channelOrderNumber,
    });

    if (!order) {
      console.warn("⚠️ Shiprocket webhook order not found:", {
        awb,
        shipmentId,
        shiprocketOrderId,
        channelOrderNumber,
        rawStatus,
        statusCode,
      });

      return res.status(200).json({
        success: true,
        updated: false,
        reason: "Order not found",
      });
    }

    console.log("✅ [SHIPROCKET-WEBHOOK] ORDER FOUND", {
      mongoId: order._id?.toString(),
      orderNumber: order.orderNumber,
      currentFulfillmentStatus: order.fulfillmentStatus,
      currentShipmentStatus: order.shipment?.status,
    });

    const existingShipment =
      order.shipment?.toObject?.() || order.shipment || {};

    const existingShiprocket =
      order.shipment?.shiprocket?.toObject?.() ||
      order.shipment?.shiprocket ||
      {};

    const existingTracking =
      order.trackingDetails?.toObject?.() || order.trackingDetails || {};

    const nextAwb =
      awb ||
      safeStr(existingShiprocket.awb) ||
      safeStr(existingShipment.awb) ||
      safeStr(existingTracking.awb) ||
      safeStr(existingTracking.trackingId);

    const nextShipmentId =
      shipmentId ||
      safeStr(existingShiprocket.shipmentId) ||
      safeStr(existingShipment.shipmentId);

    const nextShiprocketOrderId =
      shiprocketOrderId ||
      safeStr(existingShiprocket.orderId) ||
      safeStr(existingShipment.orderId);

    const nextCourierName =
      courierName ||
      safeStr(existingShiprocket.courierName) ||
      safeStr(existingShipment.courierName) ||
      safeStr(existingTracking.courierName);

    const nextTrackingUrl =
      trackingUrl ||
      safeStr(existingShiprocket.trackingUrl) ||
      safeStr(existingShipment.trackingUrl) ||
      safeStr(existingTracking.trackingUrl) ||
      (nextAwb
        ? `https://shiprocket.co/tracking/${encodeURIComponent(nextAwb)}`
        : "");

    const nextLabelUrl =
      labelUrl ||
      safeStr(existingShiprocket.labelUrl) ||
      safeStr(existingShipment.labelUrl);

    const currentFulfillmentStatus = safeStr(
      order.fulfillmentStatus,
    ).toLowerCase();

    const currentShipmentStatus = safeStr(
      existingShipment.status,
    ).toLowerCase();

    const nextShipmentStatus =
      mappedStatus || currentShipmentStatus || "booked";

    const nextFulfillmentStatus =
      mappedStatus || currentFulfillmentStatus || "shipped";

    const fulfillmentChanged =
      currentFulfillmentStatus !== nextFulfillmentStatus;

    const shipmentStatusChanged = currentShipmentStatus !== nextShipmentStatus;

    const trackingChanged =
      safeStr(existingShipment.awb) !== nextAwb ||
      safeStr(existingShipment.shipmentId) !== nextShipmentId ||
      safeStr(existingShipment.orderId) !== nextShiprocketOrderId ||
      safeStr(existingShipment.courierName) !== nextCourierName ||
      safeStr(existingShipment.trackingUrl) !== nextTrackingUrl ||
      safeStr(existingShipment.labelUrl) !== nextLabelUrl;

    /**
     * Do not downgrade a delivered order because an old webhook arrived.
     * Courier/tracking fields can still be updated.
     */
    const isDelivered =
      currentFulfillmentStatus === "delivered" ||
      currentShipmentStatus === "delivered";

    const isStatusDowngrade =
      isDelivered &&
      !["delivered", "rto", "cancelled"].includes(nextFulfillmentStatus);

    const finalFulfillmentStatus = isStatusDowngrade
      ? currentFulfillmentStatus
      : nextFulfillmentStatus;

    const finalShipmentStatus = isStatusDowngrade
      ? currentShipmentStatus
      : nextShipmentStatus;

    const finalFulfillmentChanged =
      currentFulfillmentStatus !== finalFulfillmentStatus;

    const finalShipmentChanged = currentShipmentStatus !== finalShipmentStatus;

    if (
      !finalFulfillmentChanged &&
      !finalShipmentChanged &&
      !trackingChanged &&
      safeStr(existingShipment.rawStatus) === rawStatus &&
      safeStr(existingShipment.statusCode) === statusCode
    ) {
      return res.status(200).json({
        success: true,
        updated: false,
        duplicate: true,
        orderNumber: order.orderNumber,
      });
    }

    order.shipment = {
      ...existingShipment,

      provider: "shiprocket",

      orderId: nextShiprocketOrderId,
      shipmentId: nextShipmentId,
      awb: nextAwb,
      courierName: nextCourierName,
      trackingUrl: nextTrackingUrl,
      labelUrl: nextLabelUrl,

      status: finalShipmentStatus,
      rawStatus,
      statusCode,

      lastSyncedAt: now,
      lastWebhookAt: now,
      lastWebhook: data,

      shiprocket: {
        ...existingShiprocket,

        orderId: nextShiprocketOrderId,
        shipmentId: nextShipmentId,
        awb: nextAwb,
        courierName: nextCourierName,
        trackingUrl: nextTrackingUrl,
        labelUrl: nextLabelUrl,

        lastWebhook: data,
      },
    };

    order.fulfillmentStatus = finalFulfillmentStatus;

    order.fulfillmentDates = {
      ...(order.fulfillmentDates?.toObject?.() || order.fulfillmentDates || {}),
    };

    order.trackingDetails = {
      ...existingTracking,

      trackingId: nextAwb,
      awb: nextAwb,
      provider: "shiprocket",
      courierName: nextCourierName,
      trackingUrl: nextTrackingUrl,
      expectedDelivery:
        getExpectedDelivery(data) || existingTracking.expectedDelivery || null,

      lastUpdatedAt: now,
    };

    switch (finalFulfillmentStatus) {
      case "picked":
        setDateIfMissing(order.fulfillmentDates, "pickedAt", webhookDate);

        if (!order.shipment.pickedAt) {
          order.shipment.pickedAt = webhookDate;
        }
        break;

      case "shipped":
        setDateIfMissing(order.fulfillmentDates, "shippedAt", webhookDate);

        if (!order.shipment.shippedAt) {
          order.shipment.shippedAt = webhookDate;
        }

        if (!order.trackingDetails.shippedAt) {
          order.trackingDetails.shippedAt = webhookDate;
        }
        break;

      case "out_for_delivery":
        setDateIfMissing(
          order.fulfillmentDates,
          "outForDeliveryAt",
          webhookDate,
        );

        if (!order.shipment.outForDeliveryAt) {
          order.shipment.outForDeliveryAt = webhookDate;
        }
        break;

      case "delivered":
        setDateIfMissing(order.fulfillmentDates, "deliveredAt", webhookDate);

        if (!order.shipment.deliveredAt) {
          order.shipment.deliveredAt = webhookDate;
        }

        if (!order.trackingDetails.deliveredAt) {
          order.trackingDetails.deliveredAt = webhookDate;
        }
        break;

      case "rto":
        setDateIfMissing(order.fulfillmentDates, "rtoAt", webhookDate);

        if (!order.shipment.rtoAt) {
          order.shipment.rtoAt = webhookDate;
        }
        break;

      case "cancelled":
        setDateIfMissing(order.fulfillmentDates, "cancelledAt", webhookDate);

        if (!order.shipment.cancelledAt) {
          order.shipment.cancelledAt = webhookDate;
        }
        break;

      case "failed":
        setDateIfMissing(order.fulfillmentDates, "failedAt", webhookDate);

        if (!order.shipment.failedAt) {
          order.shipment.failedAt = webhookDate;
        }
        break;

      default:
        break;
    }

    console.log("💾 [SHIPROCKET-WEBHOOK] SAVING ORDER", {
      orderNumber: order.orderNumber,
      previousFulfillmentStatus: currentFulfillmentStatus,
      nextFulfillmentStatus: finalFulfillmentStatus,
      previousShipmentStatus: currentShipmentStatus,
      nextShipmentStatus: finalShipmentStatus,
      awb: nextAwb,
      shipmentId: nextShipmentId,
      shiprocketOrderId: nextShiprocketOrderId,
      courierName: nextCourierName,
      trackingChanged,
    });

    await order.save();

    console.log("✅ [SHIPROCKET-WEBHOOK] ORDER SAVED", {
      orderNumber: order.orderNumber,
      fulfillmentStatus: order.fulfillmentStatus,
      shipmentStatus: order.shipment?.status,
      awb: order.shipment?.awb,
      courierName: order.shipment?.courierName,
    });

    /**
     * Send email only when actual fulfillment status changes.
     * Courier reassignment should not resend shipped email.
     */
    if (finalFulfillmentChanged) {
      triggerWebhookEmailSafe(order, finalFulfillmentStatus);
    }

    console.log("✅ Shiprocket webhook synced:", {
      orderNumber: order.orderNumber,
      fulfillmentStatus: finalFulfillmentStatus,
      shipmentStatus: finalShipmentStatus,
      awb: nextAwb,
      courierName: nextCourierName,
      courierReassigned: trackingChanged,
      rawStatus,
    });

    return res.status(200).json({
      success: true,
      updated: true,
      orderNumber: order.orderNumber,
      fulfillmentStatus: finalFulfillmentStatus,
      shipmentStatus: finalShipmentStatus,
      awb: nextAwb,
      courierName: nextCourierName,
      trackingUrl: nextTrackingUrl,
      trackingChanged,
    });
  } catch (error) {
    console.error("❌ [SHIPROCKET-WEBHOOK] ERROR", {
      message: error?.message,
      name: error?.name,
      stack: error?.stack,
      responseStatus: error?.response?.status,
      responseData: error?.response?.data,
      body: req.body,
    });

    return res.status(200).json({
      success: true,
      internalError: true,
      message: error?.message || "Webhook processing failed",
    });
  }
}
