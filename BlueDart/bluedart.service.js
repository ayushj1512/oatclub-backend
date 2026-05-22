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

const SERVICEABILITY_BASE_URL = String(
  BLUEDART?.SERVICEABILITY_BASE_URL ||
    "https://app.eshipz.com/api/v2"
).replace(/\/+$/, "");

const FALLBACK_CARRIER_SLUG = "bluedart";
const FALLBACK_CARRIER_NAME = "BlueDart";
const FALLBACK_VENDOR_ID = "4533749568";

/* ======================================================
   HELPERS
====================================================== */

const unwrap = (res) => res?.data ?? {};
const safeString = (v) => (v == null ? "" : String(v).trim());

const shortJson = (value, limit = 6000) => {
  try {
    const str = JSON.stringify(value, null, 2);
    return str.length > limit ? `${str.slice(0, limit)}\n...TRUNCATED...` : str;
  } catch {
    return value;
  }
};

const getFirstPayloadOrder = (payload = {}) => {
  if (Array.isArray(payload?.data)) return payload.data[0] || {};
  return payload?.data || payload || {};
};

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

const maskedHeaders = () => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-API-TOKEN": API_TOKEN
    ? `***${API_TOKEN.slice(-4)}`
    : "❌ MISSING_TOKEN",
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

const serviceabilityClient = axios.create({
  baseURL: SERVICEABILITY_BASE_URL,
  timeout: Number(BLUEDART?.TIMEOUT || 30000),
  headers: getAuthHeaders(),
});

/* ======================================================
   LOGGING
====================================================== */

const shouldLogPayload =
  String(process.env.ESHIPZ_DEBUG || process.env.BLUEDART_DEBUG || "true")
    .toLowerCase()
    .trim() !== "false";

const logConfigSnapshot = () => {
  console.log("\n========== ESHIPZ CONFIG SNAPSHOT ==========");
  console.log("BASE_URL:", BASE_URL);
  console.log("EDD_BASE_URL:", EDD_BASE_URL);
  console.log("TOKEN:", API_TOKEN ? `present ***${API_TOKEN.slice(-4)}` : "missing");
  console.log("CARRIER_NAME:", BLUEDART?.CARRIER_NAME);
  console.log("CARRIER_SLUG:", BLUEDART?.CARRIER_SLUG);
  console.log("VENDOR_ID:", BLUEDART?.VENDOR_ID);
  console.log("PUSH_ORDER ENDPOINT:", BLUEDART?.ENDPOINTS?.PUSH_ORDER || "");
  console.log("CREATE_SHIPMENT ENDPOINT:", BLUEDART?.ENDPOINTS?.CREATE_SHIPMENT || "");
  console.log("GET_ORDERS ENDPOINT:", BLUEDART?.ENDPOINTS?.GET_ORDERS || "");
  console.log("SERVICEABILITY ENDPOINT:", BLUEDART?.ENDPOINTS?.SERVICEABILITY || "");
  console.log("===========================================\n");
};

const logRequest = (label, baseUrl, endpoint, payload) => {
  const firstOrder = getFirstPayloadOrder(payload);
  console.log("FULL_FIRST_ORDER:", shortJson(firstOrder, 2000));

  console.log(`\n========== ${label} REQUEST ==========`);
  console.log("ORDER_ID:", firstOrder?.order_id || firstOrder?.orderNumber || "");
  console.log("IS_COD:", firstOrder?.is_cod);
  console.log("SERVICE_TYPE:", firstOrder?.service_type || firstOrder?.serviceType || "");
  console.log("SHIPMENT_VALUE:", firstOrder?.shipment_value);
  console.log("COD_AMOUNT:", firstOrder?.cod_amount);
  console.log("BASE_URL:", baseUrl);
  console.log("ENDPOINT:", endpoint);
  console.log("FINAL_URL:", joinUrl(baseUrl, endpoint));
  console.log("HEADERS:", maskedHeaders());

  if (shouldLogPayload && payload) {
    console.log("PAYLOAD:", shortJson(payload));
  }

  console.log("====================================\n");
};

const logGetRequest = (label, baseUrl, endpoint, params) => {
  console.log(`\n========== ${label} REQUEST ==========`);
  console.log("BASE_URL:", baseUrl);
  console.log("ENDPOINT:", endpoint);
  console.log("FINAL_URL:", joinUrl(baseUrl, endpoint));
  console.log("HEADERS:", maskedHeaders());
  console.log("QUERY PARAMS:", params || {});
  console.log("====================================\n");
};

const logResponse = (label, responseData) => {
  console.log(`\n========== ${label} RESPONSE ==========`);

  console.log("STATUS:", responseData?.status);
  console.log("REMARK:", responseData?.remark || responseData?.message || "");
  console.log("NOTE:", responseData?.note || "");
  console.log("ORDER_NOT_UPDATED:", shortJson(responseData?.order_not_updated || []));
  console.log("DATA_TYPE:", Array.isArray(responseData?.data) ? "array" : typeof responseData?.data);

  if (shouldLogPayload) {
    console.log("FULL_RESPONSE:", shortJson(responseData));
  }

  const note = safeString(responseData?.note).toLowerCase();
  const orderNotUpdated = Array.isArray(responseData?.order_not_updated)
    ? responseData.order_not_updated
    : [];

  if (note.includes("won't be created") || note.includes("wont be created")) {
    console.warn("⚠️ ESHIPZ WARNING: Order was edited before on eShipz, so API may not create/update it.");
  }

  if (orderNotUpdated.length) {
    console.warn("⚠️ ESHIPZ WARNING: order_not_updated returned:", shortJson(orderNotUpdated));
  }

  console.log("=====================================\n");
};

const logError = (label, error) => {
  console.error(`\n========== ${label} ERROR ==========`);

  console.error("MESSAGE:", error?.message);
  console.error("STATUS:", error?.response?.status);
  console.error("STATUS TEXT:", error?.response?.statusText);
  console.error("RESPONSE DATA:", shortJson(error?.response?.data || {}));
  console.error("REQUEST FINAL URL:", joinUrl(error?.config?.baseURL, error?.config?.url));
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

    logConfigSnapshot();
    logRequest(label, BASE_URL, endpoint, payload);

    const res = await client.post(endpoint, payload);
    const data = unwrap(res);

    /* =========================================
   ESHIPZ SUCCESS VALIDATION
========================================= */

const responseNote = safeString(data?.note).toLowerCase();
const responseRemark = safeString(
  data?.remark || data?.message
).toLowerCase();

const orderNotUpdated = Array.isArray(data?.order_not_updated)
  ? data.order_not_updated
  : [];

const failedBecauseEdited =
  responseNote.includes("won't be created") ||
  responseNote.includes("wont be created");

const firstOrder = getFirstPayloadOrder(payload);

if (failedBecauseEdited || orderNotUpdated.length) {
  console.error("\n❌ ESHIPZ BUSINESS FAILURE DETECTED");
  console.error("ORDER_NOT_UPDATED:", orderNotUpdated);
  console.error("NOTE:", data?.note);
  console.error("REMARK:", data?.remark);

  const err = new Error(
  "Eshipz accepted request but order was NOT created/updated"
);

err.data = data;

throw err;
}

    console.log(`✅ ${label} HTTP SUCCESS:`, res?.status);
    logResponse(label, data);



    return data;
  } catch (error) {
    logError(label, error);
    throw buildError(fallbackMessage, error);
  }
};

const get = async (endpoint, params, label, fallbackMessage) => {
  try {
    assertConfigured();
    assertEndpoint(endpoint, label);

    logConfigSnapshot();
    logGetRequest(label, BASE_URL, endpoint, params);

    const res = await client.get(endpoint, { params });
    const data = unwrap(res);

    console.log(`✅ ${label} HTTP SUCCESS:`, res?.status);
    logResponse(label, data);

    return data;
  } catch (error) {
    logError(label, error);
    throw buildError(fallbackMessage, error);
  }
};

const put = async (endpoint, payload, label, fallbackMessage) => {
  try {
    assertConfigured();
    assertEndpoint(endpoint, label);

    logConfigSnapshot();
    logRequest(label, BASE_URL, endpoint, payload);

    const res = await client.put(endpoint, payload);
    const data = unwrap(res);

    console.log(`✅ ${label} HTTP SUCCESS:`, res?.status);
    logResponse(label, data);

    return data;
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
    const data = unwrap(res);

    console.log(`✅ ${label} HTTP SUCCESS:`, res?.status);
    logResponse(label, data);

    return data;
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

export const pushOrderToBlueDart = async (payload = {}) => {
  const endpoint =
    BLUEDART?.ENDPOINTS?.PUSH_ORDER ||
    BLUEDART?.ENDPOINTS?.CREATE_ORDER ||
    BLUEDART?.ENDPOINTS?.GET_ORDERS ||
    "/api/v1/orders";

  console.log("\n🚚 BLUE DART FLOW: PUSH ORDER TO ESHIPZ");
  console.log("⚠️ This API only pushes/syncs order. AWB may not generate here.");
  console.log("Using endpoint:", endpoint);
  const firstOrder = getFirstPayloadOrder(payload);

console.log("\n========== PRE PUSH VALIDATION ==========");
console.log("ORDER_ID:", firstOrder?.order_id);
console.log("SERVICE_TYPE:", firstOrder?.service_type);
console.log("IS_COD:", firstOrder?.is_cod);
console.log("COD_AMOUNT:", firstOrder?.cod_amount);
console.log("SHIPMENT_VALUE:", firstOrder?.shipment_value);
console.log("ITEMS_COUNT:", firstOrder?.items?.length || 0);
console.log(
  "RECEIVER_PHONE:",
  firstOrder?.receiver_address?.phone
);
console.log(
  "RECEIVER_PINCODE:",
  firstOrder?.receiver_address?.zipcode
);
console.log("=========================================\n");

  return post(
    endpoint,
    payload,
    "ESHIPZ PUSH ORDER",
    "Failed to push Eshipz order"
  );
};

export const createShipmentOnBlueDart = async (payload = {}) => {
  const endpoint = BLUEDART?.ENDPOINTS?.CREATE_SHIPMENT;

  console.log("\n📦 BLUE DART FLOW: CREATE SHIPMENT ON ESHIPZ");
  console.log("Using endpoint:", endpoint);

  return post(
    endpoint,
    payload,
    "ESHIPZ CREATE SHIPMENT",
    "Failed to create Eshipz shipment"
  );
};

/* ======================================================
   SERVICEABILITY CHECK
====================================================== */

export const checkServiceabilityOnBlueDart = async (
  payload = {}
) => {
  const endpoint =
    BLUEDART?.ENDPOINTS?.SERVICEABILITY ||
    "/services";

  console.log(
    "\n🔎 BLUE DART FLOW: SERVICEABILITY CHECK"
  );

  console.log(
    "SERVICEABILITY_BASE_URL:",
    SERVICEABILITY_BASE_URL
  );

  console.log("ENDPOINT:", endpoint);

  console.log(
    "FINAL_URL:",
    joinUrl(
      SERVICEABILITY_BASE_URL,
      endpoint
    )
  );

  console.log(
    "PAYLOAD:",
    shortJson(payload)
  );

  try {
    const res =
      await serviceabilityClient.post(
        endpoint,
        payload
      );

    const data = unwrap(res);

    console.log(
      "✅ SERVICEABILITY RESPONSE:",
      shortJson(data)
    );

    return data;
  } catch (error) {
    logError(
      "ESHIPZ SERVICEABILITY",
      error
    );

    throw buildError(
      "Failed to check serviceability",
      error
    );
  }
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
    throw new Error("awbNumber, referenceNumber or shipmentId is required");
  }

  console.log("\n========== ESHIPZ TRACK FALLBACK ==========");
  console.log("AWB:", cleanAwb);
  console.log("REFERENCE:", referenceNumber);
  console.log("SHIPMENT_ID:", shipmentId);
  console.log("MESSAGE:", "Tracking API unavailable. Returning public tracking URL.");
  console.log("==========================================\n");

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
    message: "Tracking API unavailable. Using Eshipz public tracking URL.",
    tracking,

    trackingUrl: cleanAwb
      ? `${BLUEDART?.TRACKING_URL || "https://track.eshipz.com/track"}?awb=${encodeURIComponent(
          cleanAwb
        )}`
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
    throw new Error("awbNumber, referenceNumber or shipmentId is required");
  }

  console.log("\n========== ESHIPZ TRACKING HISTORY FALLBACK ==========");
  console.log("AWB:", cleanAwb);
  console.log("REFERENCE:", referenceNumber);
  console.log("SHIPMENT_ID:", shipmentId);
  console.log("======================================================\n");

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
    message: "Tracking history API unavailable. Using Eshipz public tracking URL.",
    tracking,

    trackingUrl: cleanAwb
      ? `${BLUEDART?.TRACKING_URL || "https://track.eshipz.com/track"}?awb=${encodeURIComponent(
          cleanAwb
        )}`
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