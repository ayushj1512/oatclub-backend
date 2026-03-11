// BlueDart/bluedart.constants.js

export const BLUEDART = {
  /* =====================================================
     API CONFIG
  ===================================================== */
  BASE_URL: "https://orders.eshipz.com",

  API_TOKEN: "69afd01bfe4d91fafd3615a6",

  APP_URL: "http://app.eshipz.com",

  CARRIER_SLUG: "bluedart",
  VENDOR_ID: "1511757753",

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
    picked: "picked",

    in_transit: "in_transit",
    out_for_delivery: "out_for_delivery",

    delivered: "delivered",

    rto: "rto",
    cancelled: "cancelled",
    exception: "exception",
    failed: "failed",
  },

  /* =====================================================
     API ENDPOINTS
     (eShipz APIs)
  ===================================================== */
  ENDPOINTS: {

    /*
      PUSH ORDER TO ESHIPZ
      This is the endpoint from your working curl
    */
    CREATE_SHIPMENT: "/api/v1/orders",

    /*
      Tracking / Cancel / Reverse endpoints
      will be updated once exact paths
      are confirmed from Postman collection.
    */
    TRACK_BY_AWB: "/api/v1/shipments/track",

    CANCEL_SHIPMENT: "/api/v1/shipments/cancel",

    REVERSE_SHIPMENT: "/api/v1/shipments/reverse",
  },
};