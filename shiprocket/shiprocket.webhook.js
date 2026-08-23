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
  PICKUP_BOOKED: "shipped",
  PICKUP_SCHEDULED: "shipped",
  OUT_FOR_PICKUP: "shipped",
  PICKED_UP: "shipped",
  SHIPMENT_PICKED_UP: "shipped",
  SHIPPED: "shipped",
  SHIPMENT_SHIPPED: "shipped",
  IN_TRANSIT: "shipped",
  SHIPMENT_IN_TRANSIT: "shipped",

  OUT_FOR_DELIVERY: "out_for_delivery",
  SHIPMENT_OUT_FOR_DELIVERY: "out_for_delivery",

  UNDELIVERED: "delivery_failed",
  SHIPMENT_UNDELIVERED: "delivery_failed",
  DELIVERY_FAILED: "delivery_failed",
  SHIPMENT_DELIVERY_FAILED: "delivery_failed",

  DELIVERED: "delivered",
  SHIPMENT_DELIVERED: "delivered",
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

const findReverseOrderFromWebhook = async ({
  awb,
  shipmentId,
  shiprocketOrderId,
}) => {
  const matchers = [];

  if (awb) {
    matchers.push({
      "rmas.reverseShipment.awb": awb,
    });
  }

  if (shipmentId) {
    matchers.push({
      "rmas.reverseShipment.shipmentId": shipmentId,
    });
  }

  if (shiprocketOrderId) {
    matchers.push({
      "rmas.reverseShipment.orderId": shiprocketOrderId,
    });
  }

  if (!matchers.length) return null;

  return Order.findOne({
    $or: matchers,
  });
};

const findMatchingReverseRma = (
  order,
  {
    awb,
    shipmentId,
    shiprocketOrderId,
  },
) => {
  if (!order) return null;

  return (order.rmas || []).find((rma) => {
    const reverse = rma?.reverseShipment || {};

    return (
      (awb &&
        safeStr(reverse.awb) === awb) ||
      (shipmentId &&
        safeStr(reverse.shipmentId) === shipmentId) ||
      (shiprocketOrderId &&
        safeStr(reverse.orderId) === shiprocketOrderId)
    );
  }) || null;
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
    if (!verifyWebhookToken(req)) {
      return res.status(200).json({
        success: true,
        ignored: true,
        reason: "invalid_token",
      });
    }

    const data = req.body || {};
    const now = new Date();
    const webhookDate = getWebhookDate(data);

    const awb = getAwb(data);
    const shipmentId = getShipmentId(data);
    const shiprocketOrderId =
      getShiprocketOrderId(data);
    const channelOrderNumber =
      getChannelOrderNumber(data);

    const courierName = getCourierName(data);
    const trackingUrl =
      getTrackingUrl(data, awb);
    const labelUrl = getLabelUrl(data);

    const rawStatus = getRawStatus(data);
    const normalizedStatus =
      normalizeStatus(rawStatus);
    const statusCode = getStatusCode(data);

    const mappedStatus =
      STATUS_MAP[normalizedStatus] || null;

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

    /* ============================================================
       ✅ 1. REVERSE / RMA SHIPMENT FIRST
    ============================================================ */

    let reverseOrder =
      await findReverseOrderFromWebhook({
        awb,
        shipmentId,
        shiprocketOrderId,
      });

    const reverseRma = findMatchingReverseRma(
      reverseOrder,
      {
        awb,
        shipmentId,
        shiprocketOrderId,
      },
    );

    if (reverseOrder && reverseRma) {
      const reverse =
        reverseRma.reverseShipment?.toObject?.() ||
        reverseRma.reverseShipment ||
        {};

      const PICKED = new Set([
        "PICKED_UP",
        "SHIPMENT_PICKED_UP",
        "PICKUP_COMPLETED",
        "PICKUP_DONE",
      ]);

      const IN_TRANSIT = new Set([
        "IN_TRANSIT",
        "SHIPMENT_IN_TRANSIT",
      ]);

      const RECEIVED = new Set([
        "DELIVERED",
        "SHIPMENT_DELIVERED",
        "RECEIVED",
      ]);

      let reverseStatus =
        safeStr(reverse.status) ||
        "return_order_created";

      if (PICKED.has(normalizedStatus)) {
        reverseStatus = "picked";
      } else if (
        IN_TRANSIT.has(normalizedStatus)
      ) {
        reverseStatus = "in_transit";
      } else if (
        RECEIVED.has(normalizedStatus)
      ) {
        reverseStatus = "received";
      }

      reverseRma.reverseShipment = {
        ...reverse,

        provider: "shiprocket",

        orderId:
          shiprocketOrderId ||
          safeStr(reverse.orderId),

        shipmentId:
          shipmentId ||
          safeStr(reverse.shipmentId),

        awb:
          awb ||
          safeStr(reverse.awb),

        courierName:
          courierName ||
          safeStr(reverse.courierName),

        trackingUrl:
          trackingUrl ||
          safeStr(reverse.trackingUrl),

        status: reverseStatus,

        rawStatus,
        statusCode,

        lastUpdatedAt: now,
        lastWebhook: data,
      };

      /* ---------------- PICKUP COMPLETED ---------------- */

      if (PICKED.has(normalizedStatus)) {
        reverseRma.status = "picked";

        if (
          !reverseRma.reverseShipment.pickedAt
        ) {
          reverseRma.reverseShipment.pickedAt =
            webhookDate;
        }

        reverseOrder.fulfillmentStatus =
          "return_pickup_completed";

        reverseOrder.fulfillmentDates = {
          ...(reverseOrder.fulfillmentDates
            ?.toObject?.() ||
            reverseOrder.fulfillmentDates ||
            {}),
        };

        setDateIfMissing(
          reverseOrder.fulfillmentDates,
          "returnPickupCompletedAt",
          webhookDate,
        );

        /* ✅ RETURN → REFUND ELIGIBLE */

        if (
          safeStr(reverseRma.type).toLowerCase() ===
          "return"
        ) {
          const refundAmount =
            Number(
              reverseRma?.refund?.amount || 0,
            ) ||
            Number(
              reverseOrder.finalPayable || 0,
            );

          reverseOrder.eligibleForRefund = true;
          reverseOrder.isRefunded = false;

          reverseOrder.refundSummary = {
            ...(reverseOrder.refundSummary
              ?.toObject?.() ||
              reverseOrder.refundSummary ||
              {}),

            status: "eligible",
            eligibleAmount: refundAmount,
            pendingAmount: refundAmount,

            refundedAmount: Number(
              reverseOrder.refundSummary
                ?.refundedAmount || 0,
            ),

            markedEligibleAt:
              reverseOrder.refundSummary
                ?.markedEligibleAt ||
              webhookDate,

            reason:
              reverseOrder.refundSummary
                ?.reason ||
              `Return pickup completed - ${reverseRma.rmaNumber || "RMA"
              }`,
          };
        }

        /* ✅ EXCHANGE → NO REFUND */

        if (
          safeStr(reverseRma.type).toLowerCase() ===
          "exchange"
        ) {
          reverseOrder.eligibleForRefund = false;
        }
      }

      if (
        IN_TRANSIT.has(normalizedStatus)
      ) {
        reverseRma.status = "in_transit";
      }

      if (RECEIVED.has(normalizedStatus)) {
        reverseRma.status = "received";

        if (
          !reverseRma.reverseShipment.receivedAt
        ) {
          reverseRma.reverseShipment.receivedAt =
            webhookDate;
        }
      }

      reverseOrder.markModified("rmas");

      await reverseOrder.save();

      console.log(
        "✅ Shiprocket reverse webhook synced:",
        {
          orderNumber:
            reverseOrder.orderNumber,
          rmaNumber:
            reverseRma.rmaNumber,
          type: reverseRma.type,
          reverseStatus,
          fulfillmentStatus:
            reverseOrder.fulfillmentStatus,
          eligibleForRefund:
            reverseOrder.eligibleForRefund,
        },
      );

      return res.status(200).json({
        success: true,
        updated: true,
        reverse: true,

        orderNumber:
          reverseOrder.orderNumber,

        rmaNumber:
          reverseRma.rmaNumber,

        fulfillmentStatus:
          reverseOrder.fulfillmentStatus,

        reverseStatus,
      });
    }

    /* ============================================================
       ✅ 2. NORMAL / FORWARD SHIPMENT
    ============================================================ */

    const order =
      await findOrderFromWebhook({
        awb,
        shipmentId,
        shiprocketOrderId,
        channelOrderNumber,
      });

    if (!order) {
      console.warn(
        "⚠️ Shiprocket webhook order not found:",
        {
          awb,
          shipmentId,
          shiprocketOrderId,
          channelOrderNumber,
          rawStatus,
        },
      );

      return res.status(200).json({
        success: true,
        updated: false,
        reason: "Order not found",
      });
    }

    const existingShipment =
      order.shipment?.toObject?.() ||
      order.shipment ||
      {};

    const existingShiprocket =
      order.shipment?.shiprocket
        ?.toObject?.() ||
      order.shipment?.shiprocket ||
      {};

    const existingTracking =
      order.trackingDetails?.toObject?.() ||
      order.trackingDetails ||
      {};

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
        ? `https://shiprocket.co/tracking/${encodeURIComponent(
          nextAwb,
        )}`
        : "");

    const nextLabelUrl =
      labelUrl ||
      safeStr(existingShiprocket.labelUrl) ||
      safeStr(existingShipment.labelUrl);

    const currentFulfillmentStatus =
      safeStr(
        order.fulfillmentStatus,
      ).toLowerCase();

    const currentShipmentStatus =
      safeStr(
        existingShipment.status,
      ).toLowerCase();

    const nextShipmentStatus =
      mappedStatus ||
      currentShipmentStatus ||
      "booked";

    const nextFulfillmentStatus =
      mappedStatus ||
      currentFulfillmentStatus;

    /* Don't downgrade delivered */

    const isDelivered =
      currentFulfillmentStatus === "delivered" ||
      currentShipmentStatus === "delivered";

    const isStatusDowngrade =
      isDelivered &&
      ![
        "delivered",
        "rto",
        "cancelled",
      ].includes(nextFulfillmentStatus);

    const finalFulfillmentStatus =
      isStatusDowngrade
        ? currentFulfillmentStatus
        : nextFulfillmentStatus;

    const finalShipmentStatus =
      isStatusDowngrade
        ? currentShipmentStatus
        : nextShipmentStatus;

    const finalFulfillmentChanged =
      currentFulfillmentStatus !==
      finalFulfillmentStatus;

    const trackingChanged =
      safeStr(existingShipment.awb) !==
      nextAwb ||
      safeStr(existingShipment.shipmentId) !==
      nextShipmentId ||
      safeStr(existingShipment.orderId) !==
      nextShiprocketOrderId ||
      safeStr(existingShipment.courierName) !==
      nextCourierName ||
      safeStr(existingShipment.trackingUrl) !==
      nextTrackingUrl ||
      safeStr(existingShipment.labelUrl) !==
      nextLabelUrl;

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

    order.fulfillmentStatus =
      finalFulfillmentStatus;

    order.fulfillmentDates = {
      ...(order.fulfillmentDates
        ?.toObject?.() ||
        order.fulfillmentDates ||
        {}),
    };

    order.trackingDetails = {
      ...existingTracking,

      trackingId: nextAwb,
      awb: nextAwb,
      provider: "shiprocket",
      courierName: nextCourierName,
      trackingUrl: nextTrackingUrl,

      expectedDelivery:
        getExpectedDelivery(data) ||
        existingTracking.expectedDelivery ||
        null,

      lastUpdatedAt: now,
    };

    switch (finalFulfillmentStatus) {
      case "shipped":
        setDateIfMissing(
          order.fulfillmentDates,
          "shippedAt",
          webhookDate,
        );

        order.shipment.shippedAt ||=
          webhookDate;

        order.trackingDetails.shippedAt ||=
          webhookDate;

        break;

      case "out_for_delivery":
        setDateIfMissing(
          order.fulfillmentDates,
          "outForDeliveryAt",
          webhookDate,
        );

        order.shipment.outForDeliveryAt ||=
          webhookDate;

        break;

      case "delivery_failed":
        setDateIfMissing(
          order.fulfillmentDates,
          "deliveryFailedAt",
          webhookDate,
        );

        order.shipment.deliveryFailedAt ||=
          webhookDate;

        break;

      case "delivered":
        setDateIfMissing(
          order.fulfillmentDates,
          "deliveredAt",
          webhookDate,
        );

        order.shipment.deliveredAt ||=
          webhookDate;

        order.trackingDetails.deliveredAt ||=
          webhookDate;

        break;

      case "rto":
        setDateIfMissing(
          order.fulfillmentDates,
          "rtoAt",
          webhookDate,
        );

        order.shipment.rtoAt ||=
          webhookDate;

        break;

      case "cancelled":
        setDateIfMissing(
          order.fulfillmentDates,
          "cancelledAt",
          webhookDate,
        );

        order.shipment.cancelledAt ||=
          webhookDate;

        break;

      case "failed":
        setDateIfMissing(
          order.fulfillmentDates,
          "failedAt",
          webhookDate,
        );

        order.shipment.failedAt ||=
          webhookDate;

        break;

      default:
        break;
    }

    await order.save();

    if (finalFulfillmentChanged) {
      triggerWebhookEmailSafe(
        order,
        finalFulfillmentStatus,
      );
    }

    console.log(
      "✅ Shiprocket forward webhook synced:",
      {
        orderNumber:
          order.orderNumber,
        fulfillmentStatus:
          finalFulfillmentStatus,
        shipmentStatus:
          finalShipmentStatus,
        rawStatus,
      },
    );

    return res.status(200).json({
      success: true,
      updated: true,

      orderNumber:
        order.orderNumber,

      fulfillmentStatus:
        finalFulfillmentStatus,

      shipmentStatus:
        finalShipmentStatus,

      awb: nextAwb,
      courierName: nextCourierName,
      trackingUrl: nextTrackingUrl,
      trackingChanged,
    });
  } catch (error) {
    console.error(
      "❌ [SHIPROCKET-WEBHOOK]",
      error?.response?.data ||
      error?.message ||
      error,
    );

    return res.status(200).json({
      success: true,
      internalError: true,
      message:
        error?.message ||
        "Webhook processing failed",
    });
  }
}
