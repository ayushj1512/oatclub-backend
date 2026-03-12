import axios from "axios";
import { BLUEDART } from "./bluedart.constants.js";

/* ======================================================
   CONFIG
====================================================== */

const BASE_URL = String(BLUEDART?.BASE_URL || "").replace(/\/+$/, "");
const API_TOKEN = String(BLUEDART?.API_TOKEN || "").trim();

const FALLBACK_SLUG = "bluedart";
const FALLBACK_VENDOR_ID = "1511757753";

/* ======================================================
   EDD CONFIG
====================================================== */

const EDD_BASE_URL = String(
  BLUEDART?.EDD_BASE_URL || "https://ds.eshipz.com"
).replace(/\/+$/, "");

/* ======================================================
   HELPERS
====================================================== */

const unwrap = (res) => res?.data ?? {};

const safeString = (v) => (v == null ? "" : String(v).trim());

const joinUrl = (base, path) =>
  `${String(base || "").replace(/\/+$/, "")}/${String(path || "").replace(
    /^\/+/,
    ""
  )}`;

const assertConfigured = () => {
  if (!BASE_URL) {
    throw new Error("BlueDart BASE_URL is not configured");
  }

  if (!API_TOKEN) {
    throw new Error("BlueDart API_TOKEN is not configured");
  }
};

const assertEddConfigured = () => {
  if (!EDD_BASE_URL) {
    throw new Error("BlueDart EDD_BASE_URL is not configured");
  }

  if (!API_TOKEN) {
    throw new Error("BlueDart API_TOKEN is not configured");
  }
};

const assertEndpoint = (endpoint, label = "API") => {
  if (!safeString(endpoint)) {
    throw new Error(`${label} endpoint is not configured`);
  }
};

/* ======================================================
   AXIOS CLIENTS
====================================================== */

assertConfigured();

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-API-TOKEN": API_TOKEN,
  },
});

const eddClient = axios.create({
  baseURL: EDD_BASE_URL,
  timeout: 30000,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-API-TOKEN": API_TOKEN,
  },
});

/* ======================================================
   LOGGING
====================================================== */

const maskedHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-API-TOKEN": API_TOKEN ? "***TOKEN_PRESENT***" : "",
};

const logRequest = (label, baseUrl, endpoint, payload) => {
  console.log(`\n========== ${label} ==========`);

  console.log("BASE_URL:", baseUrl);
  console.log("ENDPOINT:", endpoint);
  console.log("FINAL_URL:", joinUrl(baseUrl, endpoint));
  console.log("HEADERS:", maskedHeaders);

  if (payload) {
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
  console.log("QUERY PARAMS:", params || {});

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
    assertEndpoint(endpoint, label);

    logRequest(label, BASE_URL, endpoint, payload);

    const res = await client.post(endpoint, payload);

    console.log(`✅ ${label} SUCCESS:`, res?.data);
    return unwrap(res);
  } catch (error) {
    logError(label, error);
    throw buildError(fallbackMessage, error);
  }
};

const get = async (endpoint, params, label, fallbackMessage) => {
  try {
    assertEndpoint(endpoint, label);

    logGetRequest(label, BASE_URL, endpoint, params);

    const res = await client.get(endpoint, { params });

    console.log(`✅ ${label} SUCCESS:`, res?.data);
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

    console.log(`✅ ${label} SUCCESS:`, res?.data);
    return unwrap(res);
  } catch (error) {
    logError(label, error);
    throw buildError(fallbackMessage, error);
  }
};

/* ======================================================
   CREATE SHIPMENT / PUSH ORDER
====================================================== */

export const createShipmentOnBlueDart = async (payload) => {
  const endpoint = BLUEDART?.ENDPOINTS?.CREATE_SHIPMENT;

  return post(
    endpoint,
    payload,
    "BLUEDART CREATE SHIPMENT",
    "Failed to create BlueDart shipment"
  );
};

/* ======================================================
   TRACK SHIPMENT
====================================================== */

export const trackShipmentOnBlueDart = async ({
  awbNumber,
  referenceNumber,
}) => {
  const endpoint = BLUEDART?.ENDPOINTS?.TRACK_BY_AWB;

  const payload = {
    awb_number: safeString(awbNumber),
    reference_number: safeString(referenceNumber),
    slug: BLUEDART?.CARRIER_SLUG || FALLBACK_SLUG,
    vendor_id: BLUEDART?.VENDOR_ID || FALLBACK_VENDOR_ID,
  };

  return post(
    endpoint,
    payload,
    "BLUEDART TRACK SHIPMENT",
    "Failed to track BlueDart shipment"
  );
};

/* ======================================================
   CANCEL SHIPMENT
====================================================== */

export const cancelShipmentOnBlueDart = async ({
  awbNumber,
  referenceNumber,
}) => {
  const endpoint = BLUEDART?.ENDPOINTS?.CANCEL_SHIPMENT;

  const payload = {
    awb_number: safeString(awbNumber),
    reference_number: safeString(referenceNumber),
    slug: BLUEDART?.CARRIER_SLUG || FALLBACK_SLUG,
    vendor_id: BLUEDART?.VENDOR_ID || FALLBACK_VENDOR_ID,
  };

  return post(
    endpoint,
    payload,
    "BLUEDART CANCEL SHIPMENT",
    "Failed to cancel BlueDart shipment"
  );
};

/* ======================================================
   REVERSE SHIPMENT
====================================================== */

export const createReverseShipmentOnBlueDart = async (payload) => {
  const endpoint = BLUEDART?.ENDPOINTS?.REVERSE_SHIPMENT;

  return post(
    endpoint,
    payload,
    "BLUEDART REVERSE SHIPMENT",
    "Failed to create reverse shipment"
  );
};

/* ======================================================
   GET ORDERS
   Example:
   /api/v1/orders?per_page=10&page=1&ship_status=shipped
====================================================== */

export const getOrdersFromBlueDart = async ({
  perPage = 10,
  page = 1,
  shipStatus = "",
} = {}) => {
  const endpoint = BLUEDART?.ENDPOINTS?.GET_ORDERS || "/api/v1/orders";

  const params = {
    per_page: Number(perPage) > 0 ? Number(perPage) : 10,
    page: Number(page) > 0 ? Number(page) : 1,
  };

  if (safeString(shipStatus)) {
    params.ship_status = safeString(shipStatus);
  }

  return get(
    endpoint,
    params,
    "BLUEDART GET ORDERS",
    "Failed to fetch BlueDart orders"
  );
};

/* ======================================================
   GET SINGLE ORDER
   Example:
   /api/v1/orders/1198
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
    "BLUEDART GET SINGLE ORDER",
    "Failed to fetch BlueDart order"
  );
};

/* ======================================================
   EDD PREDICTION
   Example:
   POST /prediction/predicted-sla/v1/
====================================================== */

export const getEddPredictionFromBlueDart = async ({
  originPincode,
  destinationPincode,
  slug = "",
} = {}) => {
  const endpoint =
    BLUEDART?.ENDPOINTS?.EDD_PREDICTION ||
    "/prediction/predicted-sla/v1/";

  const payload = {
    origin_pincode: safeString(originPincode),
    destination_pincode: safeString(destinationPincode),
    slug: safeString(slug) || BLUEDART?.CARRIER_SLUG || FALLBACK_SLUG,
  };

  if (!payload.origin_pincode) {
    throw new Error("originPincode is required");
  }

  if (!payload.destination_pincode) {
    throw new Error("destinationPincode is required");
  }

  return postToEdd(
    endpoint,
    payload,
    "BLUEDART EDD PREDICTION",
    "Failed to fetch EDD prediction"
  );
};