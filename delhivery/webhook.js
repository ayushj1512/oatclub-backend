import Order from "../Orders/Orders.js";

const s = (v) => String(v || "").trim();

const normalizeStatus = (value) =>
  s(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const mapFulfillmentStatus = (rawStatus) => {
  const status = normalizeStatus(rawStatus);

  if (
    status === "delivered" ||
    status.includes("successfully delivered")
  ) {
    return "delivered";
  }

  if (
    status.includes("out for delivery") ||
    status === "ofd"
  ) {
    return "out_for_delivery";
  }

  if (
    status.includes("undelivered") ||
    status.includes("delivery failed") ||
    status.includes("failed delivery") ||
    status.includes("not delivered")
  ) {
    return "delivery_failed";
  }

  if (
    status.includes("shipped") ||
    status.includes("in transit") ||
    status.includes("dispatched") ||
    status.includes("picked up")
  ) {
    return "shipped";
  }

  return "";
};

const getShipmentObjects = (payload) => {
  if (Array.isArray(payload?.ShipmentData)) {
    return payload.ShipmentData
      .map((item) => item?.Shipment || item)
      .filter(Boolean);
  }

  if (payload?.Shipment) {
    return [payload.Shipment];
  }

  return [payload].filter(Boolean);
};

const extractEvent = (shipment = {}) => {
  const status = shipment?.Status || {};

  return {
    awb: s(
      shipment?.AWB ||
      shipment?.Waybill ||
      shipment?.waybill ||
      shipment?.awb,
    ),

    rawStatus: s(
      status?.Status ||
      shipment?.status ||
      shipment?.Status,
    ),

    statusCode: s(
      status?.StatusType ||
      status?.NSLCode ||
      shipment?.status_code,
    ),

    statusDate: s(
      status?.StatusDateTime ||
      shipment?.StatusDateTime,
    ),

    location: s(
      status?.StatusLocation ||
      shipment?.StatusLocation,
    ),

    instructions: s(
      status?.Instructions ||
      shipment?.Instructions,
    ),

    raw: shipment,
  };
};

const canApply = (currentStatus, nextStatus) => {
  const current = normalizeStatus(currentStatus);

  if (
    [
      "cancelled",
      "rto",
      "returned",
      "refunded",
      "exchanged",
    ].includes(current)
  ) {
    return false;
  }

  if (current === "delivered") {
    return nextStatus === "delivered";
  }

  // Don't regress OFD / failed back to shipped.
  if (
    nextStatus === "shipped" &&
    ["out for delivery", "out_for_delivery", "delivery failed", "delivery_failed"].includes(
      current,
    )
  ) {
    return false;
  }

  return true;
};

const shipmentStatusFor = (fulfillmentStatus) => {
  if (fulfillmentStatus === "delivery_failed") {
    return "failed";
  }

  return fulfillmentStatus;
};

export const syncDelhiveryPayload = async (
  payload,
  source = "webhook",
) => {
  const shipments = getShipmentObjects(payload);
  const results = [];

  for (const shipment of shipments) {
    const event = extractEvent(shipment);

    if (!event.awb) {
      results.push({
        success: false,
        reason: "AWB missing",
      });
      continue;
    }

    const order = await Order.findOne({
      $or: [
        { "shipment.delhivery.waybill": event.awb },
        { "shipment.delhivery.awb": event.awb },
        { "shipment.awb": event.awb },
      ],
    });

    if (!order) {
      results.push({
        success: false,
        awb: event.awb,
        reason: "Order not found",
      });
      continue;
    }

    const now = new Date();
    const nextStatus = mapFulfillmentStatus(
      event.rawStatus,
    );

    // Always save raw courier sync.
    order.shipment.rawStatus = event.rawStatus;
    order.shipment.statusCode = event.statusCode;
    order.shipment.lastSyncedAt = now;

    order.shipment.delhivery.rawStatus =
      event.rawStatus;
    order.shipment.delhivery.statusCode =
      event.statusCode;
    order.shipment.delhivery.lastSyncedAt = now;

    if (source === "webhook") {
      order.shipment.lastWebhook = event.raw;
      order.shipment.lastWebhookAt = now;

      order.shipment.delhivery.lastWebhook =
        event.raw;
      order.shipment.delhivery.lastWebhookAt =
        now;
    } else {
      order.shipment.lastTrack = event.raw;
      order.shipment.lastTrackAt = now;

      order.shipment.delhivery.lastTrack =
        event.raw;
      order.shipment.delhivery.lastTrackAt =
        now;
    }

    let fulfillmentChanged = false;

    if (
      nextStatus &&
      canApply(
        order.fulfillmentStatus,
        nextStatus,
      )
    ) {
      order.fulfillmentStatus = nextStatus;

      order.shipment.status =
        shipmentStatusFor(nextStatus);

      order.shipment.delhivery.status =
        nextStatus;

      fulfillmentChanged = true;
    }

    await order.save();

    results.push({
      success: true,
      awb: event.awb,
      rawStatus: event.rawStatus,
      fulfillmentStatus:
        order.fulfillmentStatus,
      fulfillmentChanged,
    });
  }

  return results;
};

export const delhiveryWebhook = async (
  req,
  res,
) => {
  try {
    const results =
      await syncDelhiveryPayload(
        req.body,
        "webhook",
      );

    return res.status(200).json({
      success: true,
      results,
    });
  } catch (error) {
    console.error(
      "Delhivery webhook error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Webhook processing failed.",
    });
  }
};
