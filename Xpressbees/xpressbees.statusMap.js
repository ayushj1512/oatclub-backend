// // Xpressbees/xpressbees.statusMap.js

// /**
//  * XpressBees tracking status codes from their doc: PP, IT, EX, FD, DL, RT, RT-IT, RT-DL 
//  * Map them to your order fulfillmentStatus + shipment.status
//  */

// export const XPRESSBEES_STATUS_MAP = {
//   PP: { shipmentStatus: "processing", fulfillmentStatus: "processing" },
//   IT: { shipmentStatus: "shipped", fulfillmentStatus: "shipped" },
//   EX: { shipmentStatus: "shipped", fulfillmentStatus: "shipped" },
//   FD: { shipmentStatus: "out_for_delivery", fulfillmentStatus: "out_for_delivery" },
//   DL: { shipmentStatus: "delivered", fulfillmentStatus: "delivered" },

//   RT: { shipmentStatus: "rto", fulfillmentStatus: "rto" },
//   "RT-IT": { shipmentStatus: "rto", fulfillmentStatus: "rto" },
//   "RT-DL": { shipmentStatus: "rto", fulfillmentStatus: "rto" },
// };

// export function mapXpressbeesStatus(code) {
//   const key = String(code || "").trim().toUpperCase();
//   return XPRESSBEES_STATUS_MAP[key] || { shipmentStatus: "shipped", fulfillmentStatus: "shipped" };
// }
