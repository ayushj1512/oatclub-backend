import Order from "../Orders/Orders.js";

/* ============================================================
   SHIPROCKET STATUS → INTERNAL STATUS MAP
============================================================ */
const STATUS_MAP = {
  PICKUP_GENERATED: { shipment: "processing" },
  PICKUP_SCHEDULED: { shipment: "processing" },

  PICKED_UP: { shipment: "picked", fulfillment: "shipped" },

  IN_TRANSIT: { shipment: "in_transit", fulfillment: "shipped" },
  OUT_FOR_DELIVERY: { shipment: "out_for_delivery", fulfillment: "out_for_delivery" },

  DELIVERED: { shipment: "delivered", fulfillment: "delivered" },

  RTO_INITIATED: { shipment: "rto", fulfillment: "returned" },
  RTO_IN_TRANSIT: { shipment: "rto", fulfillment: "returned" },
  RTO_DELIVERED: { shipment: "rto", fulfillment: "returned" },

  CANCELLED: { shipment: "cancelled", fulfillment: "cancelled" },
  CANCELED: { shipment: "cancelled", fulfillment: "cancelled" },
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
const normalizeStatus = (s = "") =>
  String(s).trim().toUpperCase().replace(/\s+/g, "_");

const getRawStatus = (data = {}) =>
  String(
    data.current_status ||
      data.current_status_name ||
      data.status ||
      data.shipment_status ||
      ""
  ).trim();

const safeStr = (v) => (v === undefined || v === null ? "" : String(v).trim());

/* ============================================================
   SHIPROCKET WEBHOOK
   POST /api/shiprocket/webhook
============================================================ */
export async function shiprocketWebhook(req, res) {
  try {
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
      console.warn("⚠️ Unhandled Shiprocket status:", rawStatus);
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
      });
      return res.status(200).json({ success: true });
    }

    /* ------------------------------------------------
       2) REVERSE PICKUP (RMA)
    ------------------------------------------------ */
    if (isReverse) {
      const rma = order.rmas[rmaIndex];

      // anti-regression
      if (
        rma.reverseShipment?.status &&
        SHIPMENT_PRIORITY[shipmentStatus] <
          SHIPMENT_PRIORITY[rma.reverseShipment.status]
      ) {
        return res.status(200).json({ success: true });
      }

      rma.reverseShipment = {
        ...(rma.reverseShipment || {}),
        ...(awb ? { awb } : {}),
        courierName: data.courier_name || rma.reverseShipment?.courierName,
        trackingUrl: data.tracking_url || rma.reverseShipment?.trackingUrl,
        status: shipmentStatus,
        lastUpdatedAt: now,
      };

      // Auto-advance RMA status
      if (shipmentStatus === "picked") rma.status = "picked";
      if (shipmentStatus === "in_transit") rma.status = "in_transit";
      if (shipmentStatus === "delivered") rma.status = "received";

      await order.save();
      return res.status(200).json({ success: true });
    }

    /* ------------------------------------------------
       3) FORWARD ANTI-REGRESSION
    ------------------------------------------------ */
    const prevShipmentStatus = order.shipment?.status;
    if (
      prevShipmentStatus &&
      SHIPMENT_PRIORITY[shipmentStatus] < SHIPMENT_PRIORITY[prevShipmentStatus]
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
      order.trackingDetails = {
        ...(order.trackingDetails || {}),
        trackingId: awb,
        courierName: data.courier_name || order.trackingDetails?.courierName,
        expectedDelivery: data.expected_delivery_date
          ? new Date(data.expected_delivery_date)
          : order.trackingDetails?.expectedDelivery,
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
    return res.status(200).json({ success: true });
  }
}
