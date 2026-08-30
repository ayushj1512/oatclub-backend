// Delhivery API endpoints

export const ENDPOINTS = {
  SERVICEABILITY: "/c/api/pin-codes/json/",

  SHIPPING_CHARGE: "/api/kinko/v1/invoice/charges/.json",

  // Shipment
  SHIPMENT: "/api/cmu/create.json",
  UPDATE_SHIPMENT: "/api/p/edit",
  CANCEL_SHIPMENT: "/api/p/edit",

  // Tracking / label
  TRACKING: "/api/v1/packages/json/",
  LABEL: "/api/p/packing_slip",

  // Waybill
  FETCH_WAYBILLS: "/api/wbn/bulk.json",

  // Pickup
  PICKUP: "/fm/request/new/",

  // Warehouse
  WAREHOUSE: "/api/backend/clientwarehouse/create/",
  UPDATE_WAREHOUSE: "/api/backend/clientwarehouse/edit/",

  // Documents
  DOCUMENT: "/api/rest/fetch/pkg/document/",
};
