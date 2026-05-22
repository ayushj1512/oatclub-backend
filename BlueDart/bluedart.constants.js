// BlueDart/bluedart.constants.js

export const BLUEDART = {
  /* =====================================================
     API CONFIG
  ===================================================== */

  // Main eShipz API (Orders / Shipments)
  BASE_URL:
    process.env.ESHIPZ_BASE_URL ||
    "https://app.eshipz.com/api/v1",

  // Serviceability API
  SERVICEABILITY_BASE_URL:
    process.env.ESHIPZ_SERVICEABILITY_BASE_URL ||
    "https://app.eshipz.com/api/v2",

  // EDD Prediction API
  EDD_BASE_URL:
    process.env.ESHIPZ_EDD_BASE_URL ||
    "https://ds.eshipz.com",

API_TOKEN:
  process.env.ESHIPZ_API_TOKEN ||
  process.env.BLUEDART_API_TOKEN ||
  "69afd01bfe4d91fafd3615a6",

  APP_URL: "https://app.eshipz.com",

  TRACKING_URL: "https://track.eshipz.com/track",

  TIMEOUT: 30000,

  CARRIER_NAME: "BlueDart",

  CARRIER_SLUG: "bluedart",

  VENDOR_ID:
    process.env.ESHIPZ_VENDOR_ID ||
    "4533749568",

  PROVIDER: "eshipz",

  PICKUP_PINCODE:
    process.env.ESHIPZ_PICKUP_PINCODE ||
    process.env.BLUEDART_PICKUP_PINCODE ||
    "110019",

  /* =====================================================
     SERVICE TYPES
  ===================================================== */

  SERVICE_TYPES: {
    COD: "eTailCODAir",
    PREPAID: "eTailPrePaidAir",
  },

  /* =====================================================
     DEFAULT PARCEL VALUES
  ===================================================== */

  DEFAULTS: {
    WEIGHT: 0.5,
    LENGTH: 25,
    BREADTH: 20,
    HEIGHT: 5,
    PIECES: 1,

    COUNTRY: "IN",

    CURRENCY: "INR",

    HSN_CODE: "62105000",
  },

  /* =====================================================
     STATUS NORMALIZATION MAP
  ===================================================== */

  STATUS_MAP: {
    created: "created",

    order_pushed: "order_pushed",

    pickup_pending: "pickup_pending",

    pickup_scheduled: "pickup_pending",

    ready_to_ship: "pickup_pending",

    picked: "picked",

    pickup_done: "picked",

    shipped: "in_transit",

    in_transit: "in_transit",

    transit: "in_transit",

    out_for_pickup: "in_transit",

    out_for_delivery: "out_for_delivery",

    ofd: "out_for_delivery",

    delivered: "delivered",

    rto: "rto",

    rto_initiated: "rto",

    rto_delivered: "rto",

    cancelled: "cancelled",

    canceled: "cancelled",

    exception: "exception",

    failed: "failed",

    lost: "exception",

    damaged: "exception",
  },

  /* =====================================================
     API ENDPOINTS
  ===================================================== */

  ENDPOINTS: {
    // Orders
    PUSH_ORDER:
      process.env.ESHIPZ_PUSH_ORDER_ENDPOINT ||
      "/orders",

    GET_ORDERS:
      process.env.ESHIPZ_GET_ORDERS_ENDPOINT ||
      "/orders",

    // Shipment Creation
    CREATE_SHIPMENT:
      process.env.ESHIPZ_CREATE_SHIPMENT_ENDPOINT ||
      "/create-shipments",

    UPDATE_SHIPMENT:
      process.env.ESHIPZ_UPDATE_SHIPMENT_ENDPOINT ||
      "/shipments",

    CANCEL_SHIPMENT:
      process.env.ESHIPZ_CANCEL_SHIPMENT_ENDPOINT ||
      "/shipments/cancel",

    REVERSE_SHIPMENT:
      process.env.ESHIPZ_REVERSE_SHIPMENT_ENDPOINT ||
      "/shipments/reverse",

    // Serviceability API (v2)
    SERVICEABILITY:
      process.env.ESHIPZ_SERVICEABILITY_ENDPOINT ||
      "/services",

    // Tracking
    TRACK_BY_AWB:
      process.env.ESHIPZ_TRACK_BY_AWB_ENDPOINT ||
      "/tracking",

    TRACKING_HISTORY:
      process.env.ESHIPZ_TRACKING_HISTORY_ENDPOINT ||
      "/tracking",

    // EDD Prediction
    EDD_PREDICTION:
      process.env.ESHIPZ_EDD_PREDICTION_ENDPOINT ||
      "/prediction/predicted-sla/v1/",
  },
};