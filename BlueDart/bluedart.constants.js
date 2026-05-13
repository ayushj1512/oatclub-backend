// BlueDart/bluedart.constants.js

export const BLUEDART = {
  /* =====================================================
     API CONFIG
  ===================================================== */
  BASE_URL: "https://orders.eshipz.com",

  API_TOKEN:
    process.env.ESHIPZ_API_TOKEN ||
    process.env.BLUEDART_API_TOKEN ||
    "69afd01bfe4d91fafd3615a6",

  APP_URL: "https://app.eshipz.com",

  EDD_BASE_URL: "https://ds.eshipz.com",

  /*
    Public tracking page.
    eShipz API tracking endpoint is not enabled/available
    for this account right now, so use this as fallback.
  */
  TRACKING_URL: "https://track.eshipz.com/track",

  TIMEOUT: 30000,

  CARRIER_NAME: "BlueDart",
  CARRIER_SLUG: "bluedart",
  VENDOR_ID: "1511757753",

  PROVIDER: "eshipz",

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
     eShipz APIs
  ===================================================== */
  ENDPOINTS: {
    /*
      PUSH ORDER / CREATE SHIPMENT
    */
    CREATE_SHIPMENT: "/api/v1/orders",

    /*
      GET ORDERS / SINGLE ORDER
    */
    GET_ORDERS: "/api/v1/orders",

    /*
      TRACKING APIs

      NOTE:
      These are intentionally blank because:
      - /api/v1/shipments/track returned 404
      - /api/v1/tracking returned 404

      Use TRACKING_URL fallback:
      https://track.eshipz.com/track?awb=AWB_NUMBER
    */
    TRACK_BY_AWB: "",
    TRACKING_HISTORY: "",

    /*
      CANCEL SHIPMENT
    */
    CANCEL_SHIPMENT: "/api/v1/shipments/cancel",

    /*
      REVERSE SHIPMENT / RETURN SHIPMENT
    */
    REVERSE_SHIPMENT: "/api/v1/shipments/reverse",

    /*
      UPDATE SHIPMENT
    */
    UPDATE_SHIPMENT: "/api/v1/shipments",

    /*
      EDD / SLA PREDICTION
    */
    EDD_PREDICTION: "/prediction/predicted-sla/v1/",
  },
};