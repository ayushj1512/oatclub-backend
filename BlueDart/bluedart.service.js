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

const assertEndpoint = (endpoint, label = "API") => {
  if (!safeString(endpoint)) {
    throw new Error(`${label} endpoint is not configured`);
  }
};

/* ======================================================
   AXIOS CLIENT
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

/* ======================================================
   LOGGING
====================================================== */

const logRequest = (label, endpoint, payload) => {
  console.log(`\n========== ${label} ==========`);

  console.log("BASE_URL:", BASE_URL);
  console.log("ENDPOINT:", endpoint);
  console.log("FINAL_URL:", joinUrl(BASE_URL, endpoint));
  console.log("HEADERS:", {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-API-TOKEN": API_TOKEN ? "***TOKEN_PRESENT***" : "",
  });

  if (payload) {
    console.log("PAYLOAD:", JSON.stringify(payload, null, 2));
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

  return err;
};

/* ======================================================
   REQUEST METHODS
====================================================== */

const post = async (endpoint, payload, label, fallbackMessage) => {
  try {
    assertEndpoint(endpoint, label);

    logRequest(label, endpoint, payload);

    const res = await client.post(endpoint, payload);

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