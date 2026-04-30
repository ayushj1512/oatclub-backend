// shiprocket/shiprocket.webhook.js
import Order from "../Orders/Orders.js";

const SHIPROCKET_WEBHOOK_TOKEN = process.env.SHIPROCKET_WEBHOOK_TOKEN || "";

const STATUS_MAP = {
  OUT_FOR_DELIVERY: "out_for_delivery",
  SHIPMENT_OUT_FOR_DELIVERY: "out_for_delivery",
  DELIVERED: "delivered",
  SHIPMENT_DELIVERED: "delivered",
};

const safeStr = (v) => (v === undefined || v === null ? "" : String(v).trim());

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

  const token = safeStr(
    req.header("x-api-key") ||
      req.header("anx-api-key")
  );

  return token === SHIPROCKET_WEBHOOK_TOKEN;
};

const getEventKey = (data, awb, shipmentId, status) => {
  const ts = data.current_timestamp || data.updated_at || "";
  return [awb || shipmentId, status, ts].filter(Boolean).join("|");
};

const toDate = (value) => {
  if (!value) return null;

  const str = String(value).trim();

  // Shiprocket sample: "23 05 2023 11:43:52"
  const match = str.match(/^(\d{2})\s(\d{2})\s(\d{4})\s(.+)$/);
  if (match) {
    const [, dd, mm, yyyy, time] = match;
    const d = new Date(`${yyyy}-${mm}-${dd}T${time}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(str.includes(" ") ? str.replace(" ", "T") : str);
  return Number.isNaN(d.getTime()) ? null : d;
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

    // Only update OFD + Delivered. Ignore everything else.
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

    const eventKey = getEventKey(data, awb, shipmentId, normalizedStatus);

    if (eventKey && order.shipment?.shiprocket?.lastEventKey === eventKey) {
      return res.status(200).json({ success: true });
    }

    // Delivered should never move back to OFD
    if (
      order.shipment?.status === "delivered" &&
      nextStatus === "out_for_delivery"
    ) {
      return res.status(200).json({ success: true });
    }

    order.shipment = {
      ...(order.shipment || {}),
      provider: "shiprocket",
      status: nextStatus,

      shiprocket: {
        ...(order.shipment?.shiprocket || {}),
        ...(awb ? { awb } : {}),
        shipmentId:
          shipmentId || order.shipment?.shiprocket?.shipmentId,
        courierName:
          data.courier_name || order.shipment?.shiprocket?.courierName,
        trackingUrl:
          data.tracking_url || order.shipment?.shiprocket?.trackingUrl,
        status: nextStatus,
        lastUpdatedAt: now,
        lastStatusRaw: rawStatus,
        lastStatusNorm: normalizedStatus,
        ...(eventKey ? { lastEventKey: eventKey } : {}),
      },
    };

    order.fulfillmentStatus = nextStatus;

    if (awb) {
      const expected =
        data.expected_delivery_date || data.etd || data.expected_delivery;

      order.trackingDetails = {
        ...(order.trackingDetails || {}),
        trackingId: awb,
        courierName:
          data.courier_name || order.trackingDetails?.courierName,
        expectedDelivery:
          toDate(expected) || order.trackingDetails?.expectedDelivery,
      };

      if (nextStatus === "delivered" && !order.trackingDetails.deliveredAt) {
        order.trackingDetails.deliveredAt = now;
      }
    }

    await order.save();

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Shiprocket Webhook Error:", error);
    return res.status(200).json({ success: true });
  }
}