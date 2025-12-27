import Order from "../Orders/Orders.js";

/* ============================================================
   SHIPROCKET STATUS → INTERNAL STATUS MAP
============================================================ */
const STATUS_MAP = {
  PICKUP_GENERATED: { shipment: "processing" },
  PICKUP_SCHEDULED: { shipment: "processing" },

  PICKED_UP: { shipment: "picked", fulfillment: "shipped" },

  IN_TRANSIT: { shipment: "in_transit", fulfillment: "shipped" },
  OUT_FOR_DELIVERY: {
    shipment: "out_for_delivery",
    fulfillment: "out_for_delivery",
  },

  DELIVERED: { shipment: "delivered", fulfillment: "delivered" },

  RTO_INITIATED: { shipment: "rto", fulfillment: "returned" },
  RTO_IN_TRANSIT: { shipment: "rto", fulfillment: "returned" },
  RTO_DELIVERED: { shipment: "rto", fulfillment: "returned" },

  CANCELLED: { shipment: "cancelled", fulfillment: "cancelled" },
  CANCELED: { shipment: "cancelled", fulfillment: "cancelled" },
};

/* ============================================================
   SHIPMENT STATUS PRIORITY (ANTI-REGRESSION)
============================================================ */
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
   SHIPROCKET WEBHOOK
   POST /api/shiprocket/webhook
============================================================ */
export async function shiprocketWebhook(req, res) {
  try {
    const data = req.body || {};

    const awb = String(data.awb || "").trim();
    const rawStatus = String(data.current_status || "").trim();

    // 🔐 HARD GUARD (never fail webhook)
    if (!awb || !rawStatus) {
      return res.status(200).json({ success: true });
    }

    /* ------------------------------------------------
       1️⃣ FIND ORDER (FORWARD OR REVERSE)
    ------------------------------------------------ */
    let order = await Order.findOne({
      "shipment.shiprocket.awb": awb,
    });

    let isReverse = false;
    let rmaIndex = -1;

    // 🔁 Try reverse pickup (RMA)
    if (!order) {
      order = await Order.findOne({
        "rmas.reverseShipment.awb": awb,
      });

      if (order) {
        rmaIndex = order.rmas.findIndex(
          (r) => r?.reverseShipment?.awb === awb
        );
        isReverse = rmaIndex !== -1;
      }
    }

    if (!order) {
      // Shiprocket retries aggressively — always ACK
      console.warn("⚠️ Shiprocket webhook ignored (AWB not found):", awb);
      return res.status(200).json({ success: true });
    }

    /* ------------------------------------------------
       2️⃣ NORMALIZE STATUS
    ------------------------------------------------ */
    const normalizedStatus = rawStatus
      .toUpperCase()
      .replace(/\s+/g, "_");

    const mapped = STATUS_MAP[normalizedStatus];
    if (!mapped) {
      console.warn("⚠️ Unhandled Shiprocket status:", rawStatus);
      return res.status(200).json({ success: true });
    }

    const shipmentStatus = mapped.shipment;
    const fulfillmentStatus = mapped.fulfillment;
    const now = new Date();

    /* ------------------------------------------------
       3️⃣ HANDLE REVERSE PICKUP (RMA)
    ------------------------------------------------ */
    if (isReverse) {
      const rma = order.rmas[rmaIndex];

      // Prevent regression
      if (
        rma.reverseShipment?.status &&
        SHIPMENT_PRIORITY[shipmentStatus] <
          SHIPMENT_PRIORITY[rma.reverseShipment.status]
      ) {
        return res.status(200).json({ success: true });
      }

      rma.reverseShipment = {
        ...(rma.reverseShipment || {}),
        awb,
        courierName:
          data.courier_name || rma.reverseShipment?.courierName,
        trackingUrl:
          data.tracking_url || rma.reverseShipment?.trackingUrl,
        status: shipmentStatus,
        lastUpdatedAt: now,
      };

      // Auto-advance RMA
      if (shipmentStatus === "picked") rma.status = "picked";
      if (shipmentStatus === "in_transit") rma.status = "in_transit";
      if (shipmentStatus === "delivered") rma.status = "received";

      await order.save();
      return res.status(200).json({ success: true });
    }

    /* ------------------------------------------------
       4️⃣ IDEMPOTENCY + REGRESSION CHECK (FORWARD)
    ------------------------------------------------ */
    const prevShipmentStatus = order.shipment?.status;

    if (
      prevShipmentStatus &&
      SHIPMENT_PRIORITY[shipmentStatus] <
        SHIPMENT_PRIORITY[prevShipmentStatus]
    ) {
      return res.status(200).json({ success: true });
    }

    /* ------------------------------------------------
       5️⃣ UPDATE SHIPMENT SNAPSHOT
    ------------------------------------------------ */
    order.shipment = {
      ...(order.shipment || {}),
      provider: "shiprocket",

      shiprocket: {
        ...(order.shipment?.shiprocket || {}),
        awb,
        shipmentId: data.shipment_id
          ? String(data.shipment_id)
          : order.shipment?.shiprocket?.shipmentId,
        courierName:
          data.courier_name || order.shipment?.shiprocket?.courierName,
        trackingUrl:
          data.tracking_url || order.shipment?.shiprocket?.trackingUrl,
        status: shipmentStatus,
        lastUpdatedAt: now,
      },

      status: shipmentStatus,
    };

    /* ------------------------------------------------
       6️⃣ UPDATE FULFILLMENT STATUS
    ------------------------------------------------ */
    if (fulfillmentStatus) {
      order.fulfillmentStatus = fulfillmentStatus;
    }

    /* ------------------------------------------------
       7️⃣ UPDATE TRACKING DETAILS
    ------------------------------------------------ */
    order.trackingDetails = {
      ...(order.trackingDetails || {}),
      trackingId: awb,
      courierName:
        data.courier_name || order.trackingDetails?.courierName,
      expectedDelivery: data.expected_delivery_date
        ? new Date(data.expected_delivery_date)
        : order.trackingDetails?.expectedDelivery,
    };

    if (shipmentStatus === "picked" && !order.trackingDetails.shippedAt) {
      order.trackingDetails.shippedAt = now;
    }

    if (
      shipmentStatus === "delivered" &&
      !order.trackingDetails.deliveredAt
    ) {
      order.trackingDetails.deliveredAt = now;
    }

    /* ------------------------------------------------
       8️⃣ SAVE ORDER
    ------------------------------------------------ */
    await order.save();

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Shiprocket Webhook Error:", error);

    // NEVER fail webhook
    return res.status(200).json({ success: true });
  }
}
