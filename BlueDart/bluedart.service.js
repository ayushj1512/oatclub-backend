import axios from "axios";
import { BLUEDART } from "./bluedart.constants.js";

/* ======================================================
   CONFIG
====================================================== */

const BASE_URL = String(BLUEDART?.BASE_URL || "").replace(/\/+$/, "");
const API_TOKEN = String(BLUEDART?.API_TOKEN || "").trim();

const EDD_BASE_URL = String(
  BLUEDART?.EDD_BASE_URL || "https://ds.eshipz.com"
).replace(/\/+$/, "");

const FALLBACK_CARRIER_SLUG = "bluedart";
const FALLBACK_CARRIER_NAME = "BlueDart";
const FALLBACK_VENDOR_ID = "1511757753";

/* ======================================================
   HELPERS
====================================================== */

const unwrap = (res) => res?.data ?? {};
const safeString = (v) => (v == null ? "" : String(v).trim());

const cleanObject = (obj = {}) => {
  const cleaned = { ...obj };

  Object.keys(cleaned).forEach((key) => {
    if (
      cleaned[key] === undefined ||
      cleaned[key] === null ||
      cleaned[key] === ""
    ) {
      delete cleaned[key];
    }
  });

  return cleaned;
};

const joinUrl = (base, path) =>
  `${String(base || "").replace(/\/+$/, "")}/${String(path || "").replace(
    /^\/+/,
    ""
  )}`;

const getAuthHeaders = () => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-API-TOKEN": API_TOKEN,
});

const assertConfigured = () => {
  if (!BASE_URL) throw new Error("Eshipz BASE_URL is not configured");
  if (!API_TOKEN) throw new Error("Eshipz API_TOKEN is not configured");
};

const assertEddConfigured = () => {
  if (!EDD_BASE_URL) throw new Error("Eshipz EDD_BASE_URL is not configured");
  if (!API_TOKEN) throw new Error("Eshipz API_TOKEN is not configured");
};

const assertEndpoint = (endpoint, label = "API") => {
  if (!safeString(endpoint)) {
    throw new Error(`${label} endpoint is not configured`);
  }
};

const getCarrierSlug = (slug = "") =>
  safeString(slug) ||
  safeString(BLUEDART?.CARRIER_SLUG) ||
  FALLBACK_CARRIER_SLUG;

const getCarrierName = (name = "") =>
  safeString(name) ||
  safeString(BLUEDART?.CARRIER_NAME) ||
  FALLBACK_CARRIER_NAME;

const getVendorId = (vendorId = "") =>
  safeString(vendorId) ||
  safeString(BLUEDART?.VENDOR_ID) ||
  FALLBACK_VENDOR_ID;

const normalizeDateValue = (value = "") => {
  if (!value) return "";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

/* ======================================================
   AXIOS CLIENTS
====================================================== */

assertConfigured();

const client = axios.create({
  baseURL: BASE_URL,
  timeout: Number(BLUEDART?.TIMEOUT || 30000),
  headers: getAuthHeaders(),
});

const eddClient = axios.create({
  baseURL: EDD_BASE_URL,
  timeout: Number(BLUEDART?.TIMEOUT || 30000),
  headers: getAuthHeaders(),
});

/* ======================================================
   LOGGING
====================================================== */

const maskedHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-API-TOKEN": API_TOKEN ? "***TOKEN_PRESENT***" : "",
};

const shouldLogPayload =
  String(process.env.ESHIPZ_DEBUG || process.env.BLUEDART_DEBUG || "")
    .toLowerCase()
    .trim() === "true";

const logRequest = (label, baseUrl, endpoint, payload) => {
  console.log(`\n========== ${label} ==========`);

  console.log("BASE_URL:", baseUrl);
  console.log("ENDPOINT:", endpoint);
  console.log("FINAL_URL:", joinUrl(baseUrl, endpoint));
  console.log("HEADERS:", maskedHeaders);

  if (shouldLogPayload && payload) {
    console.log("PAYLOAD:", JSON.stringify(payload, null, 2));
  }

  console.log("====================================\n");
};

const logGetRequest = (label, baseUrl, endpoint, params) => {
  console.log(`\n========== ${label} ==========`);

  console.log("BASE_URL:", baseUrl);
  console.log("ENDPOINT:", endpoint);
  console.log("FINAL_URL:", joinUrl(baseUrl, endpoint));
  console.log("HEADERS:", maskedHeaders);

  if (shouldLogPayload) {
    console.log("QUERY PARAMS:", params || {});
  }

  console.log("====================================\n");
};

const logError = (label, error) => {
  console.error(`\n========== ${label} ERROR ==========`);

  console.error("MESSAGE:", error?.message);
  console.error("STATUS:", error?.response?.status);
  console.error("STATUS TEXT:", error?.response?.statusText);
  console.error("RESPONSE DATA:", error?.response?.data);
  console.error("REQUEST URL:", error?.config?.url);
  console.error("REQUEST BASE URL:", error?.config?.baseURL);
  console.error("REQUEST METHOD:", error?.config?.method);
  console.error("REQUEST PARAMS:", error?.config?.params);
  console.error("REQUEST DATA:", error?.config?.data);

  console.error("====================================\n");
};

const buildError = (fallback, error) => {
  const responseData = error?.response?.data || null;

  const err = new Error(
    responseData?.meta?.message ||
      responseData?.message ||
      responseData?.error ||
      responseData?.detail ||
      error?.message ||
      fallback
  );

  err.status = error?.response?.status || 500;
  err.statusText = error?.response?.statusText || "";
  err.data = responseData;
  err.url = error?.config?.url || "";
  err.baseURL = error?.config?.baseURL || "";
  err.method = error?.config?.method || "";
  err.params = error?.config?.params || null;

  return err;
};

/* ======================================================
   REQUEST METHODS
====================================================== */

const post = async (endpoint, payload, label, fallbackMessage) => {
  try {
    assertConfigured();
    assertEndpoint(endpoint, label);

    logRequest(label, BASE_URL, endpoint, payload);

    const res = await client.post(endpoint, payload);

    console.log(`✅ ${label} SUCCESS`);
    return unwrap(res);
  } catch (error) {
    logError(label, error);
    throw buildError(fallbackMessage, error);
  }
};

const get = async (endpoint, params, label, fallbackMessage) => {
  try {
    assertConfigured();
    assertEndpoint(endpoint, label);

    logGetRequest(label, BASE_URL, endpoint, params);

    const res = await client.get(endpoint, { params });

    console.log(`✅ ${label} SUCCESS`);
    return unwrap(res);
  } catch (error) {
    logError(label, error);
    throw buildError(fallbackMessage, error);
  }
};

const put = async (endpoint, payload, label, fallbackMessage) => {
  try {
    assertConfigured();
    assertEndpoint(endpoint, label);

    logRequest(label, BASE_URL, endpoint, payload);

    const res = await client.put(endpoint, payload);

    console.log(`✅ ${label} SUCCESS`);
    return unwrap(res);
  } catch (error) {
    logError(label, error);
    throw buildError(fallbackMessage, error);
  }
};

const postToEdd = async (endpoint, payload, label, fallbackMessage) => {
  try {
    assertEddConfigured();
    assertEndpoint(endpoint, label);

    logRequest(label, EDD_BASE_URL, endpoint, payload);

    const res = await eddClient.post(endpoint, payload);

    console.log(`✅ ${label} SUCCESS`);
    return unwrap(res);
  } catch (error) {
    logError(label, error);
    throw buildError(fallbackMessage, error);
  }
};

/* ======================================================
   TRACKING NORMALIZER
====================================================== */

const normalizeTrackingEvent = (event = {}) => ({
  status:
    event?.status ||
    event?.scan_status ||
    event?.shipment_status ||
    event?.activity ||
    event?.event ||
    "",
  description:
    event?.description ||
    event?.scan_description ||
    event?.remarks ||
    event?.message ||
    "",
  location:
    event?.location ||
    event?.scan_location ||
    event?.city ||
    event?.hub ||
    "",
  date: normalizeDateValue(
    event?.date ||
      event?.time ||
      event?.datetime ||
      event?.scan_time ||
      event?.created_at
  ),
  raw: event,
});

export const normalizeEshipzTracking = (raw = {}) => {
  const data =
    raw?.data ||
    raw?.result ||
    raw?.tracking ||
    raw?.shipment ||
    raw?.shipment_track ||
    raw ||
    {};

  const rawEvents =
    data?.events ||
    data?.scans ||
    data?.tracking_history ||
    data?.checkpoints ||
    data?.activities ||
    raw?.events ||
    raw?.scans ||
    [];

  const events = Array.isArray(rawEvents)
    ? rawEvents.map(normalizeTrackingEvent)
    : [];

  const latestEvent = events?.[0] || {};

  return {
    raw,

    awbNumber:
      data?.awb_number ||
      data?.awb ||
      data?.waybill ||
      data?.tracking_number ||
      raw?.awb_number ||
      "",

    shipmentId: data?.shipment_id || data?.id || raw?.shipment_id || "",

    referenceNumber:
      data?.reference_number ||
      data?.order_id ||
      data?.customer_reference ||
      raw?.reference_number ||
      "",

    carrier:
      data?.carrier ||
      data?.carrier_name ||
      data?.slug ||
      raw?.carrier ||
      getCarrierName(),

    carrierSlug: data?.slug || raw?.slug || getCarrierSlug(),

    status:
      data?.status ||
      data?.current_status ||
      data?.shipment_status ||
      latestEvent?.status ||
      "",

    description:
      data?.description ||
      data?.remarks ||
      data?.message ||
      latestEvent?.description ||
      "",

    location:
      data?.location ||
      data?.current_location ||
      latestEvent?.location ||
      "",

    statusDate: normalizeDateValue(
      data?.status_date ||
        data?.updated_at ||
        data?.last_updated_at ||
        latestEvent?.date
    ),

    edd:
      data?.edd ||
      data?.expected_delivery_date ||
      data?.estimated_delivery_date ||
      data?.promised_delivery_date ||
      "",

    deliveredAt: normalizeDateValue(
      data?.delivered_at || data?.delivery_date || ""
    ),

    pod:
      data?.pod ||
      data?.pod_url ||
      data?.proof_of_delivery ||
      data?.delivery_proof ||
      "",

    events,
  };
};

/* ======================================================
   CREATE SHIPMENT / PUSH ORDER
====================================================== */

export const createShipmentOnBlueDart = async (payload = {}) => {
  const endpoint = BLUEDART?.ENDPOINTS?.CREATE_SHIPMENT;

  return post(
    endpoint,
    payload,
    "ESHIPZ CREATE SHIPMENT",
    "Failed to create Eshipz shipment"
  );
};

/* ======================================================
   TRACK SHIPMENT
====================================================== */

export const trackShipmentOnBlueDart = async ({
  awbNumber,
  awb,
  referenceNumber,
  shipmentId,
  carrierSlug,
  vendorId,
} = {}) => {
  const cleanAwb = safeString(awbNumber || awb);

  if (!cleanAwb && !referenceNumber && !shipmentId) {
    throw new Error(
      "awbNumber, referenceNumber or shipmentId is required"
    );
  }

  /*
    eShipz tracking API endpoint currently returns 404
    for this account.

    So we return normalized fallback tracking data
    + public tracking URL.
  */

  const tracking = normalizeEshipzTracking({
    awb_number: cleanAwb,
    reference_number: safeString(referenceNumber),
    shipment_id: safeString(shipmentId),
    carrier: getCarrierName(),
    slug: getCarrierSlug(carrierSlug),
    vendor_id: getVendorId(vendorId),
    status: "tracking_pending",
    message: "Tracking available on public Eshipz page",
  });

  return {
    success: true,
    message:
      "Tracking API unavailable. Using Eshipz public tracking URL.",
    tracking,

    trackingUrl: cleanAwb
      ? `${
          BLUEDART?.TRACKING_URL ||
          "https://track.eshipz.com/track"
        }?awb=${encodeURIComponent(cleanAwb)}`
      : "",
  };
};

/* ======================================================
   TRACKING HISTORY
====================================================== */

export const getTrackingHistoryFromBlueDart = async ({
  awbNumber,
  awb,
  referenceNumber,
  shipmentId,
  carrierSlug,
  vendorId,
} = {}) => {
  const cleanAwb = safeString(awbNumber || awb);

  if (!cleanAwb && !referenceNumber && !shipmentId) {
    throw new Error(
      "awbNumber, referenceNumber or shipmentId is required"
    );
  }

  /*
    eShipz tracking history endpoint unavailable.
    Returning safe fallback structure.
  */

  const tracking = normalizeEshipzTracking({
    awb_number: cleanAwb,
    reference_number: safeString(referenceNumber),
    shipment_id: safeString(shipmentId),
    carrier: getCarrierName(),
    slug: getCarrierSlug(carrierSlug),
    vendor_id: getVendorId(vendorId),
    status: "tracking_pending",
    message: "Tracking history available on public Eshipz page",
    events: [],
  });

  return {
    success: true,
    message:
      "Tracking history API unavailable. Using Eshipz public tracking URL.",
    tracking,

    trackingUrl: cleanAwb
      ? `${
          BLUEDART?.TRACKING_URL ||
          "https://track.eshipz.com/track"
        }?awb=${encodeURIComponent(cleanAwb)}`
      : "",
  };
};
/* ======================================================
   BULK TRACK SHIPMENTS
====================================================== */

export const bulkTrackShipmentsOnBlueDart = async (shipments = []) => {
  if (!Array.isArray(shipments) || !shipments.length) {
    throw new Error("shipments array is required");
  }

  const results = await Promise.allSettled(
    shipments.map((shipment) => trackShipmentOnBlueDart(shipment))
  );

  return {
    success: true,
    total: results.length,
    successCount: results.filter((r) => r.status === "fulfilled").length,
    failedCount: results.filter((r) => r.status === "rejected").length,
    results: results.map((result, index) => ({
      input: shipments[index],
      success: result.status === "fulfilled",
      data: result.status === "fulfilled" ? result.value : null,
      error: result.status === "rejected" ? result.reason?.message : null,
    })),
  };
};

/* ======================================================
   CANCEL SHIPMENT
====================================================== */

export const cancelShipmentOnBlueDart = async ({
  awbNumber,
  awb,
  referenceNumber,
  shipmentId,
  carrierSlug,
  vendorId,
} = {}) => {
  const endpoint = BLUEDART?.ENDPOINTS?.CANCEL_SHIPMENT;

  const cleanAwb = safeString(awbNumber || awb);

  const payload = cleanObject({
    awb_number: cleanAwb,
    reference_number: safeString(referenceNumber),
    shipment_id: safeString(shipmentId),
    slug: getCarrierSlug(carrierSlug),
    vendor_id: getVendorId(vendorId),
  });

  if (!payload.awb_number && !payload.reference_number && !payload.shipment_id) {
    throw new Error("awbNumber, referenceNumber or shipmentId is required");
  }

  return post(
    endpoint,
    payload,
    "ESHIPZ CANCEL SHIPMENT",
    "Failed to cancel Eshipz shipment"
  );
};

/* ======================================================
   REVERSE SHIPMENT
====================================================== */

export const createReverseShipmentOnBlueDart = async (payload = {}) => {
  const endpoint = BLUEDART?.ENDPOINTS?.REVERSE_SHIPMENT;

  return post(
    endpoint,
    payload,
    "ESHIPZ REVERSE SHIPMENT",
    "Failed to create Eshipz reverse shipment"
  );
};

/* ======================================================
   GET ORDERS
====================================================== */

export const getOrdersFromBlueDart = async ({
  perPage = 10,
  page = 1,
  shipStatus = "",
  carrierSlug = "",
} = {}) => {
  const endpoint = BLUEDART?.ENDPOINTS?.GET_ORDERS || "/api/v1/orders";

  const params = cleanObject({
    per_page: Number(perPage) > 0 ? Number(perPage) : 10,
    page: Number(page) > 0 ? Number(page) : 1,
    ship_status: safeString(shipStatus),
    slug: safeString(carrierSlug) ? getCarrierSlug(carrierSlug) : "",
  });

  return get(
    endpoint,
    params,
    "ESHIPZ GET ORDERS",
    "Failed to fetch Eshipz orders"
  );
};

/* ======================================================
   GET SINGLE ORDER
====================================================== */

export const getSingleOrderFromBlueDart = async (salesChannelOrderId) => {
  const cleanId = safeString(salesChannelOrderId);

  if (!cleanId) {
    throw new Error("salesChannelOrderId is required");
  }

  const baseEndpoint = BLUEDART?.ENDPOINTS?.GET_ORDERS || "/api/v1/orders";
  const endpoint = `${baseEndpoint}/${encodeURIComponent(cleanId)}`;

  return get(
    endpoint,
    {},
    "ESHIPZ GET SINGLE ORDER",
    "Failed to fetch Eshipz order"
  );
};

/* ======================================================
   EDD PREDICTION
====================================================== */

export const getEddPredictionFromBlueDart = async ({
  originPincode,
  destinationPincode,
  slug = "",
} = {}) => {
  const endpoint =
    BLUEDART?.ENDPOINTS?.EDD_PREDICTION || "/prediction/predicted-sla/v1/";

  const payload = cleanObject({
    origin_pincode: safeString(originPincode),
    destination_pincode: safeString(destinationPincode),
    slug: getCarrierSlug(slug),
  });

  if (!payload.origin_pincode) {
    throw new Error("originPincode is required");
  }

  if (!payload.destination_pincode) {
    throw new Error("destinationPincode is required");
  }

  return postToEdd(
    endpoint,
    payload,
    "ESHIPZ EDD PREDICTION",
    "Failed to fetch Eshipz EDD prediction"
  );
};

/* ======================================================
   OPTIONAL: GENERIC ESHIPZ HELPERS
====================================================== */

export const getBlueDartCarrierMeta = () => ({
  provider: "eshipz",
  carrierName: getCarrierName(),
  carrierSlug: getCarrierSlug(),
  vendorId: getVendorId(),
});

export const updateShipmentOnBlueDart = async ({
  shipmentId,
  payload = {},
} = {}) => {
  const cleanShipmentId = safeString(shipmentId);

  if (!cleanShipmentId) {
    throw new Error("shipmentId is required");
  }

  const baseEndpoint = BLUEDART?.ENDPOINTS?.UPDATE_SHIPMENT;

  if (!baseEndpoint) {
    throw new Error("Eshipz UPDATE_SHIPMENT endpoint is not configured");
  }

  const endpoint = `${baseEndpoint}/${encodeURIComponent(cleanShipmentId)}`;

  return put(
    endpoint,
    payload,
    "ESHIPZ UPDATE SHIPMENT",
    "Failed to update Eshipz shipment"
  );
};