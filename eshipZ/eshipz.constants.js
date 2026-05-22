// eshipZ/eshipz.constants.js

export const ESHIPZ = {
  /*
   |--------------------------------------------------------------------------
   | BASE CONFIG
   |--------------------------------------------------------------------------
   |
   | NOTE:
   | orders.eshipz.com works for legacy order APIs.
   | create-shipments endpoint may require account-specific host.
   |
   | If shipment API still 404s:
   | ask eShipz support for exact shipment API host.
   |
   */

  BASE_URL: "https://orders.eshipz.com",

  /*
   |--------------------------------------------------------------------------
   | AUTH
   |--------------------------------------------------------------------------
   */

  API_TOKEN: "69afd01bfe4d91fafd3615a6",

  /*
   |--------------------------------------------------------------------------
   | APP URLS
   |--------------------------------------------------------------------------
   */

  APP_URL: "https://app.eshipz.com",

  TRACKING_URL: "https://track.eshipz.com/track",

  /*
   |--------------------------------------------------------------------------
   | GENERAL
   |--------------------------------------------------------------------------
   */

  TIMEOUT: 30000,

  PROVIDER: "eshipz",

  CARRIER_NAME: "BlueDart",
  CARRIER_SLUG: "bluedart",

  /*
   |--------------------------------------------------------------------------
   | ACCOUNT / VENDOR
   |--------------------------------------------------------------------------
   */

  VENDOR_ID: "9212052189",

  /*
   |--------------------------------------------------------------------------
   | DEFAULT PICKUP
   |--------------------------------------------------------------------------
   |
   | Replace these with your real pickup details.
   |
   */

  PICKUP: {
    contact_name: "Miray Fashions",

    company_name: "Miray Fashions",

    street1: "Delhi",

    street2: "Delhi",

    city: "Delhi",

    state: "DL",

    postal_code: "110019",

    phone: "9999999999",

    email: "support@mirayfashions.com",

    tax_id: "",

    country: "IN",

    type: "business",
  },

  /*
   |--------------------------------------------------------------------------
   | SERVICE TYPES
   |--------------------------------------------------------------------------
   */

  SERVICE_TYPES: {
    COD: "eTailCODAir",

    PREPAID: "eTailPrePaidAir",
  },

  /*
   |--------------------------------------------------------------------------
   | DEFAULT PACKAGE VALUES
   |--------------------------------------------------------------------------
   */

  DEFAULTS: {
    WEIGHT: 0.5,

    LENGTH: 25,

    BREADTH: 20,

    HEIGHT: 5,

    COUNTRY: "IN",

    CURRENCY: "INR",
  },

  /*
   |--------------------------------------------------------------------------
   | ENDPOINTS
   |--------------------------------------------------------------------------
   |
   | Docs show relative endpoints only.
   | Some accounts expose different routes.
   |
   */

  ENDPOINTS: {
    /*
     |------------------------------------------------------------
     | LEGACY ORDER PUSH
     |------------------------------------------------------------
     |
     | This endpoint is responding currently on your account.
     |
     */

    PUSH_ORDER: "/api/v1/orders",

    /*
     |------------------------------------------------------------
     | CREATE SHIPMENT
     |------------------------------------------------------------
     |
     | Currently 404 on your account using orders.eshipz.com
     |
     | Likely needs account-specific host/subdomain.
     |
     */

  CREATE_SHIPMENT: "/api/v1/orders",

    /*
     |------------------------------------------------------------
     | TRACKING
     |------------------------------------------------------------
     */

    TRACKING: "/api/v1/track",

    /*
     |------------------------------------------------------------
     | CANCEL
     |------------------------------------------------------------
     */

    CANCEL_SHIPMENT: "/api/v1/cancel-shipment",
  },

  /*
   |--------------------------------------------------------------------------
   | HEADERS
   |--------------------------------------------------------------------------
   |
   | eShipz docs mention X-API-TOKEN.
   | Keeping multiple variants for compatibility testing.
   |
   */

  HEADERS: {
    "Content-Type": "application/json",

    "X-API-TOKEN": "69afd01bfe4d91fafd3615a6",

    "X-API-TOKEN;": "69afd01bfe4d91fafd3615a6",

    Authorization: "69afd01bfe4d91fafd3615a6",
  },
};