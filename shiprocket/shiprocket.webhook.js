// shiprocket/shiprocket.webhook.js
import Order from "../Orders/Orders.js";
import { triggerFulfillmentStatusEmail } from "../Orders/order.emails.js";

const SHIPROCKET_WEBHOOK_TOKEN = process.env.SHIPROCKET_WEBHOOK_TOKEN || "";

const STATUS_MAP = {
  OUT_FOR_DELIVERY: "out_for_delivery",
  SHIPMENT_OUT_FOR_DELIVERY: "out_for_delivery",
  DELIVERED: "delivered",
  SHIPMENT_DELIVERED: "delivered",
};

const safeStr = (v) => (v === undefined || v === null ? "" : String(v).trim());

const cleanObject = (v) =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};

const normalizeStatus = (s = "") =>
  String(s)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const getRawStatus = (data = {}) =>
  safeStr(
    data.current_status ||
      data.shipment_status ||
      data.current_status_name ||
      data.status
  );

const verifyWebhookToken = (req) => {
  if (!SHIPROCKET_WEBHOOK_TOKEN) return true;

  const token = safeStr(req.header("x-api-key") || req.header("anx-api-key"));
  return token === SHIPROCKET_WEBHOOK_TOKEN;
};

const getEventKey = (data, awb, shipmentId, status) => {
  const ts = data.current_timestamp || data.updated_at || "";
  return [awb || shipmentId, status, ts].filter(Boolean).join("|");
};

const toDate = (value) => {
  if (!value) return null;

  const str = String(value).trim();

  const match = str.match(/^(\d{2})\s(\d{2})\s(\d{4})\s(.+)$/);
  if (match) {
    const [, dd, mm, yyyy, time] = match;
    const d = new Date(`${yyyy}-${mm}-${dd}T${time}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(str.includes(" ") ? str.replace(" ", "T") : str);
  return Number.isNaN(d.getTime()) ? null : d;
};

const triggerWebhookEmailSafe = (order, nextStatus) => {
  try {
    triggerFulfillmentStatusEmail(
      order?.toObject ? order.toObject() : order,
      nextStatus
    );
  } catch (e) {
    console.error(
      "⚠️ Shiprocket webhook email trigger failed:",
      e?.message || e
    );
  }
};

export async function shiprocketWebhook(req, res) {
  try {
    if (!verifyWebhookToken(req)) {
      console.warn("⚠️ Shiprocket webhook invalid x-api-key");
      return res.status(200).json({ success: true });
    }

    const data = req.body || {};
    const now = new Date();

    const awb = safeStr(data.awb || data.awb_code);
    const shipmentId = safeStr(data.shipment_id || data.sr_order_id);
    const orderNumber = safeStr(data.order_id || data.channel_order_id);

    const rawStatus = getRawStatus(data);
    const normalizedStatus = normalizeStatus(rawStatus);
    const nextStatus = STATUS_MAP[normalizedStatus];

    if (!nextStatus) {
      return res.status(200).json({ success: true });
    }

    let order = null;

    if (awb) {
      order = await Order.findOne({ "shipment.shiprocket.awb": awb });
    }

    if (!order && shipmentId) {
      order = await Order.findOne({
        "shipment.shiprocket.shipmentId": String(shipmentId),
      });
    }

    if (!order && orderNumber) {
      order = await Order.findOne({ orderNumber });
    }

    if (!order) {
      console.warn("⚠️ Shiprocket webhook order not found:", {
        awb,
        shipmentId,
        orderNumber,
        rawStatus,
      });

      return res.status(200).json({ success: true });
    }

    const existingShipment = cleanObject(order.shipment);
    const existingShiprocket = cleanObject(existingShipment.shiprocket);
    const existingXpressbees = cleanObject(existingShipment.xpressbees);

    const currentFulfillment = String(
      order.fulfillmentStatus || ""
    ).toLowerCase();

    const currentShipmentStatus = String(
      existingShipment.status || ""
    ).toLowerCase();

    const eventKey = getEventKey(data, awb, shipmentId, normalizedStatus);

    if (eventKey && existingShiprocket.lastEventKey === eventKey) {
      return res.status(200).json({ success: true });
    }

    if (
      existingShipment.status === "delivered" &&
      nextStatus === "out_for_delivery"
    ) {
      return res.status(200).json({ success: true });
    }

    if (
      currentFulfillment === nextStatus &&
      currentShipmentStatus === nextStatus
    ) {
      return res.status(200).json({ success: true });
    }

    order.shipment = {
      provider: "shiprocket",
      status: nextStatus,

      shiprocket: {
        orderId: existingShiprocket.orderId || "",
        shipmentId: shipmentId || existingShiprocket.shipmentId || "",
        awb: awb || existingShiprocket.awb || "",
        courierName:
          data.courier_name || existingShiprocket.courierName || "",
        trackingUrl:
          data.tracking_url || existingShiprocket.trackingUrl || "",
        status: nextStatus,
        lastUpdatedAt: now,
        lastStatusRaw: rawStatus,
        lastStatusNorm: normalizedStatus,
        ...(eventKey ? { lastEventKey: eventKey } : {}),
      },

      // ✅ IMPORTANT: never allow undefined here
      // fixes: shipment.xpressbees Cast to Object failed for value "undefined"
      xpressbees: {
        shipmentId: existingXpressbees.shipmentId || "",
        awb: existingXpressbees.awb || "",
        labelUrl: existingXpressbees.labelUrl || "",
        courierName: existingXpressbees.courierName || "XpressBees",
        trackingUrl: existingXpressbees.trackingUrl || "",
        lastWebhook: existingXpressbees.lastWebhook || null,
        lastTrack: existingXpressbees.lastTrack || null,
      },

      shippedAt: existingShipment.shippedAt || undefined,
      deliveredAt: existingShipment.deliveredAt || undefined,
    };

    order.fulfillmentStatus = nextStatus;

    order.fulfillmentDates = {
      ...(order.fulfillmentDates || {}),
    };

    if (
      nextStatus === "out_for_delivery" &&
      !order.fulfillmentDates.outForDeliveryAt
    ) {
      order.fulfillmentDates.outForDeliveryAt = now;
    }

    if (nextStatus === "delivered" && !order.fulfillmentDates.deliveredAt) {
      order.fulfillmentDates.deliveredAt = now;
    }

    if (awb) {
      const expected =
        data.expected_delivery_date || data.etd || data.expected_delivery;

      order.trackingDetails = {
        ...(order.trackingDetails || {}),
        trackingId: awb,
        courierName:
          data.courier_name || order.trackingDetails?.courierName || "",
        trackingUrl:
          data.tracking_url || order.trackingDetails?.trackingUrl || "",
        expectedDelivery:
          toDate(expected) || order.trackingDetails?.expectedDelivery,
      };

      if (nextStatus === "delivered" && !order.trackingDetails.deliveredAt) {
        order.trackingDetails.deliveredAt = now;
      }
    }

    await order.save();

    triggerWebhookEmailSafe(order, nextStatus);

    return res.status(200).json({
      success: true,
      updated: true,
      orderNumber: order.orderNumber,
      status: nextStatus,
    });
  } catch (error) {
    console.error("❌ Shiprocket Webhook Error:", error);
    return res.status(200).json({ success: true });
  }
}