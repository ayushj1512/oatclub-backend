import Order from "../Orders/Orders.js";

/* ============================================================
   CONFIG
============================================================ */
const SHIPROCKET_WEBHOOK_TOKEN = process.env.SHIPROCKET_WEBHOOK_TOKEN || "";

/* ============================================================
   SHIPROCKET STATUS → INTERNAL STATUS MAP
============================================================ */
const STATUS_MAP = {
  /* ------------------------------
     Pickup / Manifest
  ------------------------------ */
  PICKUP_GENERATED: { shipment: "processing" },
  PICKUP_SCHEDULED: { shipment: "processing" },
  MANIFEST_GENERATED: { shipment: "processing" },
  SHIPMENT_CREATED: { shipment: "processing" },
  ORDER_CREATED: { shipment: "processing" },

  /* ------------------------------
     Picked up
  ------------------------------ */
  PICKED_UP: { shipment: "picked", fulfillment: "shipped" },
  SHIPMENT_PICKED_UP: { shipment: "picked", fulfillment: "shipped" },

  /* ------------------------------
     In Transit / Movement
  ------------------------------ */
  IN_TRANSIT: { shipment: "in_transit", fulfillment: "shipped" },
  SHIPMENT_IN_TRANSIT: { shipment: "in_transit", fulfillment: "shipped" },
  SHIPMENT_ARRIVED: { shipment: "in_transit", fulfillment: "shipped" },
  SHIPMENT_ARRIVED_AT_HUB: { shipment: "in_transit", fulfillment: "shipped" },
  SHIPMENT_FURTHER_CONNECTED: { shipment: "in_transit", fulfillment: "shipped" },

  /* ------------------------------
     Out for delivery
  ------------------------------ */
  OUT_FOR_DELIVERY: {
    shipment: "out_for_delivery",
    fulfillment: "out_for_delivery",
  },
  SHIPMENT_OUT_FOR_DELIVERY: {
    shipment: "out_for_delivery",
    fulfillment: "out_for_delivery",
  },

  /* ------------------------------
     Delivered
  ------------------------------ */
  DELIVERED: { shipment: "delivered", fulfillment: "delivered" },
  SHIPMENT_DELIVERED: { shipment: "delivered", fulfillment: "delivered" },

  /* ------------------------------
     RTO / Returned
  ------------------------------ */
  RTO_INITIATED: { shipment: "rto", fulfillment: "returned" },
  RTO_IN_TRANSIT: { shipment: "rto", fulfillment: "returned" },
  RTO_DELIVERED: { shipment: "rto", fulfillment: "returned" },
  RETURNED: { shipment: "rto", fulfillment: "returned" },
  RETURN_DELIVERED: { shipment: "rto", fulfillment: "returned" },

  /* ------------------------------
     Cancelled
  ------------------------------ */
  CANCELLED: { shipment: "cancelled", fulfillment: "cancelled" },
  CANCELED: { shipment: "cancelled", fulfillment: "cancelled" },
  SHIPMENT_CANCELLED: { shipment: "cancelled", fulfillment: "cancelled" },
  SHIPMENT_CANCELED: { shipment: "cancelled", fulfillment: "cancelled" },
};

const SHIPMENT_PRIORITY = {
  processing: 1,
  picked: 2,
  in_transit: 3,
  out_for_delivery: 4,
  delivered: 5,
  rto: 6,
  cancelled: 7,
};

/* ============================================================
   HELPERS
============================================================ */
const safeStr = (v) => (v === undefined || v === null ? "" : String(v).trim());

const normalizeStatus = (s = "") =>
  String(s)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_") // handles spaces, hyphens, slashes etc.
    .replace(/^_+|_+$/g, "");

const getLastScanStatus = (data = {}) => {
  const scans = Array.isArray(data.scans) ? data.scans : [];
  const last = scans.length ? scans[scans.length - 1] : null;
  return (
    last?.["sr-status-label"] ||
    last?.status ||
    last?.activity ||
    ""
  );
};

const getRawStatus = (data = {}) =>
  String(
    data.current_status ||
      data.current_status_name ||
      getLastScanStatus(data) ||
      data.status ||
      data.shipment_status ||
      ""
  ).trim();

const stageOf = (s) => SHIPMENT_PRIORITY[s] || 0;

/**
 * Webhook idempotency key
 * - uses awb OR shipmentId + normalizedStatus + a timestamp-ish field (if present)
 * - Shiprocket may resend same payload → avoid repeated DB writes
 */
const getEventKey = (data, awb, shipmentId, normalizedStatus) => {
  const ts =
    data.current_timestamp ||
    data.current_tracking_status_datetime ||
    data.updated_at ||
    "";
  return [awb || shipmentId, normalizedStatus, String(ts)].filter(Boolean).join("|");
};

const verifyWebhookToken = (req) => {
  if (!SHIPROCKET_WEBHOOK_TOKEN) return true; // if you didn't set token in env/dashboard
  const token = (req.header("x-api-key") || "").trim();
  return token === SHIPROCKET_WEBHOOK_TOKEN;
};

/* ============================================================
   SHIPROCKET WEBHOOK
   POST /api/shiprocket/webhook
============================================================ */
export async function shiprocketWebhook(req, res) {
  try {
    // 0) Optional security token verification
    if (!verifyWebhookToken(req)) {
      return res.status(401).json({ success: false });
    }

    const data = req.body || {};
    const now = new Date();

    const awb = safeStr(data.awb || data.awb_code);
    const shipmentId = safeStr(data.shipment_id);
    const channelOrderId = safeStr(data.channel_order_id || data.order_id);

    const rawStatus = getRawStatus(data);
    if (!rawStatus) return res.status(200).json({ success: true });

    const normalizedStatus = normalizeStatus(rawStatus);
    const mapped = STATUS_MAP[normalizedStatus];

    if (!mapped) {
      // keep ACKing 200 to avoid retries, but log for mapping expansion
      console.warn("⚠️ Unhandled Shiprocket status:", {
        rawStatus,
        normalizedStatus,
        awb,
        shipmentId,
        channelOrderId,
      });
      return res.status(200).json({ success: true });
    }

    const shipmentStatus = mapped.shipment;
    const fulfillmentStatus = mapped.fulfillment;

    /* ------------------------------------------------
       1) FIND ORDER (AWB OR SHIPMENT ID OR ORDER NUMBER)
    ------------------------------------------------ */
    let order = null;
    let isReverse = false;
    let rmaIndex = -1;

    // Forward by AWB
    if (awb) {
      order = await Order.findOne({ "shipment.shiprocket.awb": awb });
    }

    // Forward by shipmentId (important when AWB is empty)
    if (!order && shipmentId) {
      order = await Order.findOne({
        "shipment.shiprocket.shipmentId": shipmentId,
      });
    }

    // Forward by channel order id (orderNumber)
    if (!order && channelOrderId) {
      order = await Order.findOne({ orderNumber: channelOrderId });
    }

    // Reverse (RMA) by AWB
    if (!order && awb) {
      order = await Order.findOne({ "rmas.reverseShipment.awb": awb });

      if (order) {
        rmaIndex = order.rmas.findIndex((r) => r?.reverseShipment?.awb === awb);
        isReverse = rmaIndex !== -1;
      }
    }

    if (!order) {
      console.warn("⚠️ Shiprocket webhook ignored (Order not found):", {
        awb,
        shipmentId,
        channelOrderId,
        rawStatus,
        normalizedStatus,
      });
      return res.status(200).json({ success: true });
    }

    const eventKey = getEventKey(data, awb, shipmentId, normalizedStatus);

    /* ------------------------------------------------
       2) REVERSE PICKUP (RMA)
    ------------------------------------------------ */
    if (isReverse) {
      const rma = order.rmas[rmaIndex];

      // idempotency (reverse)
      const lastKey = rma?.reverseShipment?.lastEventKey;
      if (eventKey && lastKey === eventKey) {
        return res.status(200).json({ success: true });
      }

      // anti-regression (reverse)
      const prev = rma.reverseShipment?.status;
      if (prev && stageOf(shipmentStatus) < stageOf(prev)) {
        return res.status(200).json({ success: true });
      }

      rma.reverseShipment = {
        ...(rma.reverseShipment || {}),
        ...(awb ? { awb } : {}),
        courierName: data.courier_name || rma.reverseShipment?.courierName,
        trackingUrl: data.tracking_url || rma.reverseShipment?.trackingUrl,
        status: shipmentStatus,
        lastUpdatedAt: now,
        ...(eventKey ? { lastEventKey: eventKey } : {}),
      };

      // Auto-advance RMA status
      if (shipmentStatus === "picked") rma.status = "picked";
      if (shipmentStatus === "in_transit") rma.status = "in_transit";
      if (shipmentStatus === "delivered") rma.status = "received";

      await order.save();
      return res.status(200).json({ success: true });
    }

    /* ------------------------------------------------
       3) FORWARD IDPOTENCY + SAFER ANTI-REGRESSION
    ------------------------------------------------ */
    const prevShipmentStatus = order.shipment?.status;

    // idempotency (forward)
    const lastForwardKey = order.shipment?.shiprocket?.lastEventKey;
    if (eventKey && lastForwardKey === eventKey) {
      return res.status(200).json({ success: true });
    }

    // anti-regression basic
    if (prevShipmentStatus && stageOf(shipmentStatus) < stageOf(prevShipmentStatus)) {
      return res.status(200).json({ success: true });
    }

    // special safety rules
    //  - cancelled should not override late stages
    if (
      shipmentStatus === "cancelled" &&
      prevShipmentStatus &&
      stageOf(prevShipmentStatus) > stageOf("processing")
    ) {
      return res.status(200).json({ success: true });
    }

    //  - rto should not override delivered forward shipment (keep forward delivered stable)
    if (
      shipmentStatus === "rto" &&
      prevShipmentStatus &&
      stageOf(prevShipmentStatus) >= stageOf("delivered")
    ) {
      return res.status(200).json({ success: true });
    }

    /* ------------------------------------------------
       4) UPDATE SHIPMENT SNAPSHOT
    ------------------------------------------------ */
    order.shipment = {
      ...(order.shipment || {}),
      provider: "shiprocket",

      shiprocket: {
        ...(order.shipment?.shiprocket || {}),
        ...(awb ? { awb } : {}),
        shipmentId: shipmentId || order.shipment?.shiprocket?.shipmentId,
        courierName: data.courier_name || order.shipment?.shiprocket?.courierName,
        trackingUrl: data.tracking_url || order.shipment?.shiprocket?.trackingUrl,
        status: shipmentStatus,
        lastUpdatedAt: now,

        // idempotency tracking
        ...(eventKey ? { lastEventKey: eventKey } : {}),

        // optional: store raw status for debugging
        lastStatusRaw: rawStatus,
        lastStatusNorm: normalizedStatus,
      },

      status: shipmentStatus,
    };

    /* ------------------------------------------------
       5) UPDATE FULFILLMENT STATUS
    ------------------------------------------------ */
    if (fulfillmentStatus) order.fulfillmentStatus = fulfillmentStatus;

    /* ------------------------------------------------
       6) UPDATE TRACKING DETAILS (only if AWB present)
    ------------------------------------------------ */
    if (awb) {
      const expected =
        data.expected_delivery_date || data.etd || data.expected_delivery || null;

      order.trackingDetails = {
        ...(order.trackingDetails || {}),
        trackingId: awb,
        courierName: data.courier_name || order.trackingDetails?.courierName,
        expectedDelivery: expected ? new Date(expected) : order.trackingDetails?.expectedDelivery,
      };

      if (shipmentStatus === "picked" && !order.trackingDetails.shippedAt) {
        order.trackingDetails.shippedAt = now;
      }

      if (shipmentStatus === "delivered" && !order.trackingDetails.deliveredAt) {
        order.trackingDetails.deliveredAt = now;
      }
    }

    await order.save();
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Shiprocket Webhook Error:", error);
    // Always ACK 200 to avoid Shiprocket retries storm
    return res.status(200).json({ success: true });
  }
}
