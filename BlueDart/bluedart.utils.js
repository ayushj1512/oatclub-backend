import { BLUEDART } from "./bluedart.constants.js";

const safe = (v) => (v == null ? "" : String(v).trim());
const lower = (v) => safe(v).toLowerCase();

export const getBlueDartPaymentMode = (order = {}) => {
  const paymentMethod = lower(order?.paymentMethod);

  if (paymentMethod === "cod") return "COD";
  return "Prepaid";
};

export const getBlueDartServiceType = (order = {}) => {
  const mode = getBlueDartPaymentMode(order);

  return mode === "COD"
    ? BLUEDART.SERVICE_TYPES.COD
    : BLUEDART.SERVICE_TYPES.PREPAID;
};

export const getOrderTotalWeight = (order = {}) => {
  const items = Array.isArray(order?.items) ? order.items : [];

  const sum = items.reduce((acc, item) => {
    const qty = Math.max(1, Number(item?.quantity || 1));

    const variantWeight = Number(item?.variant?.weight || 0);
    const productWeight = Number(item?.productSnapshot?.weight || 0);

    const weight = variantWeight > 0 ? variantWeight : productWeight;

    return acc + weight * qty;
  }, 0);

  return sum > 0 ? sum : BLUEDART.DEFAULTS.WEIGHT;
};

export const normalizePincode = (v) => safe(v).replace(/\D/g, "");
export const normalizePhone = (v) => safe(v).replace(/\D/g, "");

export const isValidIndianPincode = (v) => /^\d{6}$/.test(normalizePincode(v));
export const isValidPhone = (v) => /^\d{10,15}$/.test(normalizePhone(v));

export const assertAddressValid = (address = {}, label = "Address") => {
  if (!safe(address?.fullName)) {
    throw new Error(`${label}: fullName is required`);
  }

  if (!safe(address?.line1)) {
    throw new Error(`${label}: line1 is required`);
  }

  if (!safe(address?.city)) {
    throw new Error(`${label}: city is required`);
  }

  if (!safe(address?.state)) {
    throw new Error(`${label}: state is required`);
  }

  if (!isValidIndianPincode(address?.pincode)) {
    throw new Error(`${label}: valid pincode is required`);
  }

  if (!isValidPhone(address?.phone)) {
    throw new Error(`${label}: valid phone is required`);
  }
};

export const parseDateSafe = (value) => {
  if (!value) return null;

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const nonEmpty = (v) => safe(v).length > 0;

export const normalizeCourierName = (value = "") => {
  const raw = safe(value);

  if (!raw) return "BlueDart";

  const s = raw.toLowerCase().replace(/\s+/g, "");

  if (s.includes("bluedart") || s.includes("blue-dart")) return "BlueDart";
  if (s.includes("xpressbees")) return "XpressBees";
  if (s.includes("delhivery")) return "Delhivery";
  if (s.includes("dtdc")) return "DTDC";
  if (s.includes("ecom")) return "Ecom Express";

  return raw;
};

export const normalizeCarrierSlug = (value = "") => {
  const courier = normalizeCourierName(value);

  return courier
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
};

/**
 * eShipz/BlueDart status -> local shipment status
 */
export const normalizeTrackingStatus = (rawStatus = "") => {
  const s = lower(rawStatus);

  if (!s) return "created";

  if (
    s.includes("delivered") ||
    s.includes("shipment delivered") ||
    s === "dl"
  ) {
    return "delivered";
  }

  if (
    s.includes("out for delivery") ||
    s.includes("ofd") ||
    s.includes("out_for_delivery")
  ) {
    return "out_for_delivery";
  }

  if (
    s.includes("in transit") ||
    s.includes("transit") ||
    s.includes("shipped") ||
    s.includes("dispatched") ||
    s.includes("arrived") ||
    s.includes("departed")
  ) {
    return "in_transit";
  }

  if (
    s.includes("pickup scheduled") ||
    s.includes("pickup_scheduled") ||
    s.includes("pickup generated")
  ) {
    return "pickup_scheduled";
  }

  if (
    s.includes("pickup pending") ||
    s.includes("pickup_pending") ||
    s.includes("manifested") ||
    s.includes("created") ||
    s.includes("booked") ||
    s.includes("order placed")
  ) {
    return "pickup_pending";
  }

  if (
    s.includes("picked") ||
    s.includes("picked up") ||
    s.includes("pickup done")
  ) {
    return "picked";
  }

  if (
    s.includes("rto") ||
    s.includes("return to origin") ||
    s.includes("returned to origin")
  ) {
    return "rto";
  }

  if (
    s.includes("cancel") ||
    s.includes("cancelled") ||
    s.includes("canceled")
  ) {
    return "cancelled";
  }

  if (
    s.includes("exception") ||
    s.includes("undelivered") ||
    s.includes("failed") ||
    s.includes("lost") ||
    s.includes("damaged")
  ) {
    return "exception";
  }

  return "created";
};

/**
 * local shipment status -> Order.shipment.status
 */
export const toOrderShipmentStatus = (status = "") => {
  const s = lower(status);

  const map = {
    draft: "pending",
    order_pushed: "processing",
    created: "processing",
    booked: "booked",
    pickup_pending: "pickup_scheduled",
    pickup_scheduled: "pickup_scheduled",
    picked: "picked",
    shipped: "shipped",
    in_transit: "in_transit",
    out_for_delivery: "out_for_delivery",
    delivered: "delivered",
    exception: "failed",
    rto: "rto",
    cancelled: "cancelled",
    failed: "failed",
  };

  return map[s] || "processing";
};

/**
 * local shipment status -> Order.fulfillmentStatus
 */
export const toOrderFulfillmentStatus = (status = "") => {
  const s = lower(status);

  const map = {
    draft: "processing",
    order_pushed: "processing",
    created: "processing",
    booked: "packed",
    pickup_pending: "packed",
    pickup_scheduled: "packed",
    picked: "picked",
    shipped: "shipped",
    in_transit: "shipped",
    out_for_delivery: "out_for_delivery",
    delivered: "delivered",
    exception: "failed",
    rto: "rto",
    cancelled: "cancelled",
    failed: "failed",
  };

  return map[s] || "processing";
};

export const getStatusDateField = (status = "") => {
  const s = lower(status);

  const map = {
    booked: "bookedAt",
    pickup_scheduled: "pickupScheduledAt",
    pickup_pending: "pickupScheduledAt",
    picked: "pickedUpAt",
    shipped: "shippedAt",
    in_transit: "shippedAt",
    out_for_delivery: "outForDeliveryAt",
    delivered: "deliveredAt",
    rto: "rtoAt",
    exception: "failedAt",
    failed: "failedAt",
    cancelled: "cancelledAt",
  };

  return map[s] || "";
};

export const buildTrackingUrl = (awb = "") => {
  const cleanAwb = safe(awb);

  if (!cleanAwb) return "";

  if (BLUEDART?.TRACKING_URL) {
    return `${BLUEDART.TRACKING_URL}${encodeURIComponent(cleanAwb)}`;
  }

  return "";
};

export const pickFirst = (...values) => {
  for (const value of values) {
    if (nonEmpty(value)) return safe(value);
  }

  return "";
};

export const extractEshipzIds = (payload = {}) => {
  const data = payload?.data || payload?.result || payload?.shipment || payload;

  const awb = pickFirst(
    data?.awb,
    data?.awb_number,
    data?.awbNumber,
    data?.waybill,
    data?.tracking_number,
    data?.trackingNumber,
    data?.label?.awb
  );

  const shipmentId = pickFirst(
    data?.shipment_id,
    data?.shipmentId,
    data?.id,
    data?._id,
    data?.eshipz_shipment_id
  );

  const orderId = pickFirst(
    data?.order_id,
    data?.orderId,
    data?.reference_number,
    data?.referenceNumber,
    data?.invoice_number
  );

  const labelUrl = pickFirst(
    data?.label_url,
    data?.labelUrl,
    data?.label,
    data?.documents?.label,
    data?.files?.label
  );

  const invoiceUrl = pickFirst(
    data?.invoice_url,
    data?.invoiceUrl,
    data?.documents?.invoice,
    data?.files?.invoice
  );

  const manifestUrl = pickFirst(
    data?.manifest_url,
    data?.manifestUrl,
    data?.documents?.manifest,
    data?.files?.manifest
  );

  const carrierName = normalizeCourierName(
    pickFirst(
      data?.carrier_name,
      data?.carrierName,
      data?.courier_name,
      data?.courierName,
      data?.carrier,
      data?.vendor_name
    )
  );

  const serviceType = pickFirst(
    data?.service_type,
    data?.serviceType,
    data?.service,
    data?.product_type
  );

  const status = normalizeTrackingStatus(
    pickFirst(
      data?.status,
      data?.current_status,
      data?.currentStatus,
      data?.shipment_status
    )
  );

  return {
    awb,
    shipmentId,
    orderId,
    labelUrl,
    invoiceUrl,
    manifestUrl,
    carrierName,
    carrierSlug: normalizeCarrierSlug(carrierName),
    serviceType,
    status,
    rawStatus: pickFirst(
      data?.status,
      data?.current_status,
      data?.currentStatus,
      data?.shipment_status
    ),
    statusCode: pickFirst(data?.status_code, data?.statusCode),
    trackingUrl: pickFirst(
      data?.tracking_url,
      data?.trackingUrl,
      data?.track_url,
      buildTrackingUrl(awb)
    ),
    expectedDelivery: parseDateSafe(
      data?.expected_delivery ||
        data?.expectedDelivery ||
        data?.estimated_delivery_date ||
        data?.edd
    ),
  };
};

export const buildOrderShipmentPatch = ({
  shipment = {},
  raw = null,
  source = "sync",
} = {}) => {
  const status = normalizeTrackingStatus(shipment?.status || shipment?.rawStatus);
  const orderShipmentStatus = toOrderShipmentStatus(status);
  const orderFulfillmentStatus = toOrderFulfillmentStatus(status);

  const now = new Date();

  const patch = {
    "shipment.provider": "eshipz",

    "shipment.orderId": shipment?.orderId || "",
    "shipment.shipmentId": shipment?.shipmentId || "",
    "shipment.awb": shipment?.awb || "",
    "shipment.courierName": shipment?.carrierName || "BlueDart",
    "shipment.trackingUrl": shipment?.trackingUrl || "",
    "shipment.labelUrl": shipment?.labelUrl || "",
    "shipment.status": orderShipmentStatus,
    "shipment.rawStatus": shipment?.rawStatus || shipment?.status || "",
    "shipment.statusCode": shipment?.statusCode || "",

    "shipment.lastSyncedAt": now,

    "shipment.eshipz.orderId": shipment?.orderId || "",
    "shipment.eshipz.shipmentId": shipment?.shipmentId || "",
    "shipment.eshipz.awb": shipment?.awb || "",
    "shipment.eshipz.courierName": shipment?.carrierName || "BlueDart",
    "shipment.eshipz.carrierId": shipment?.carrierId || "",
    "shipment.eshipz.serviceType": shipment?.serviceType || "",
    "shipment.eshipz.trackingUrl": shipment?.trackingUrl || "",
    "shipment.eshipz.labelUrl": shipment?.labelUrl || "",
    "shipment.eshipz.invoiceUrl": shipment?.invoiceUrl || "",
    "shipment.eshipz.manifestUrl": shipment?.manifestUrl || "",
    "shipment.eshipz.status": status,
    "shipment.eshipz.statusCode": shipment?.statusCode || "",
    "shipment.eshipz.expectedDelivery": shipment?.expectedDelivery || null,

    "trackingDetails.trackingId": shipment?.awb || "",
    "trackingDetails.awb": shipment?.awb || "",
    "trackingDetails.provider": "eshipz",
    "trackingDetails.courierName": shipment?.carrierName || "BlueDart",
    "trackingDetails.trackingUrl": shipment?.trackingUrl || "",
    "trackingDetails.expectedDelivery": shipment?.expectedDelivery || null,
    "trackingDetails.lastUpdatedAt": now,
  };

  if (source === "webhook") {
    patch["shipment.lastWebhookAt"] = now;
    patch["shipment.lastWebhook"] = raw;
    patch["shipment.eshipz.lastWebhook"] = raw;
  } else {
    patch["shipment.lastTrackAt"] = now;
    patch["shipment.lastTrack"] = raw;
    patch["shipment.eshipz.lastTrack"] = raw;
  }

  if (orderFulfillmentStatus) {
    patch.fulfillmentStatus = orderFulfillmentStatus;
  }

  const dateField = getStatusDateField(status);

  if (dateField) {
    patch[`shipment.${dateField}`] = now;

    if (dateField === "deliveredAt") {
      patch["trackingDetails.deliveredAt"] = now;
    }

    if (dateField === "shippedAt") {
      patch["trackingDetails.shippedAt"] = now;
    }
  }

  return patch;
};