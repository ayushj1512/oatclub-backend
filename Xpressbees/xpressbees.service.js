// // Xpressbees/xpressbees.service.js

// import { xbFetch } from "./xpressbees.client.js";
// import { XPRESSBEES_API, XPRESSBEES_KEYS } from "./xpressbees.constants.js";
// import {
//   mapOrderToAwbSeriesPayload,
//   mapOrderToForwardManifestPayload,
//   mapAwbTrackingSummaryPayload,
//   mapAwbTrackingBulkPayload,
//   mapRtoCancelPayload,
// } from "./xpressbees.mapper.js";
// import { mapXpressbeesStatus } from "./xpressbees.statusMap.js";
// import Order from "../Orders/Orders.js";

// const safeTrim = (v) => String(v || "").trim();
// const getXbKey = () => safeTrim(XPRESSBEES_KEYS.xbAccessKey || XPRESSBEES_KEYS.xbKey);

// function pickFirstAwbFromSeriesResponse(raw) {
//   const candidates = [
//     raw,
//     raw?.data,
//     raw?.response,
//     raw?.result,
//     raw?.data?.result,
//     raw?.response?.data,
//     raw?.response?.result,
//   ];

//   for (const r of candidates) {
//     if (!r) continue;

//     // common direct fields
//     const awb = r.awb || r.awbNo || r.awbNumber || r.AWB || r.awb_number;
//     if (awb) return safeTrim(awb);

//     // common array fields
//     const arr = r.awbs || r.awbNumbers || r.AWBs;
//     if (Array.isArray(arr) && arr.length) return safeTrim(arr[0]);

//     // ✅ batch endpoint often returns AWBNoSeries
//     const series = r.AWBNoSeries || r.awbNoSeries;
//     if (Array.isArray(series) && series.length) return safeTrim(series[0]);
//     if (typeof series === "string" && series) return safeTrim(series);
//   }

//   return "";
// }

// function assertAwbSeriesOk(seriesRaw, payload) {
//   // ✅ For these XB .svc endpoints, 100 is success ("successful")
//   const rc = seriesRaw?.ReturnCode;
//   if (rc == null) return;

//   const code = Number(rc);
//   if (code === 100 || code === 200) return;

//   throw new Error(
//     `XB AWB series failed: ${seriesRaw?.ReturnMessage} (ReturnCode ${seriesRaw?.ReturnCode}). ` +
//       `Payload: ${JSON.stringify(payload)}`
//   );
// }

// async function callAwbSeries(url, payload, { withHeaders = true } = {}) {
//   const xbKey = getXbKey();

//   return xbFetch(url, {
//     method: "POST",
//     body: payload,
//     headers: withHeaders
//       ? {
//           xbAccessKey: xbKey,
//           xbKey: xbKey,
//           "xb-access-key": xbKey,
//           "xb-key": xbKey,
//           "x-access-key": xbKey,
//         }
//       : undefined,
//   });
// }

// async function fetchAwbFromBatch({ batchId, awbSeriesPayload }) {
//   const xbKey = getXbKey();

//   // ✅ batch endpoint requires these (you saw "Provide service type")
//   const businessUnit =
//     safeTrim(awbSeriesPayload?.BusinessUnit) ||
//     safeTrim(XPRESSBEES_KEYS.businessUnit) ||
//     safeTrim(process.env.XPRESSBEES_BUSINESS_UNIT);

//   const serviceType = safeTrim(awbSeriesPayload?.ServiceType); // FORWARD/REVERSE
//   const deliveryType = safeTrim(awbSeriesPayload?.DeliveryType); // COD/PREPAID

//   const payload = {
//     xbAccessKey: xbKey,
//     xbKey: xbKey,

//     BusinessUnit: businessUnit,
//     ServiceType: serviceType,
//     DeliveryType: deliveryType,

//     BatchID: safeTrim(batchId),
//   };

//   const raw = await xbFetch(XPRESSBEES_API.GET_AWB_NUMBER_GENERATED_SERIES, {
//     method: "POST",
//     body: payload,
//     headers: {
//       xbAccessKey: xbKey,
//       xbKey: xbKey,
//       "xb-access-key": xbKey,
//       "xb-key": xbKey,
//     },
//   });

//   return raw;
// }

// // ----------------------------------------------------------
// // 1) Create Shipment (AWB → Forward Manifest)
// // ----------------------------------------------------------
// export async function createShipmentForOrder(orderId, opts = {}) {
//   const { force = false } = opts;

//   const order = await Order.findById(orderId);
//   if (!order) throw new Error("Order not found");

//   if (!order.isConfirmed && !force) {
//     throw new Error("Order must be confirmed before creating shipment (pass force=true)");
//   }

//   const terminal = ["cancelled", "delivered", "rto"];
//   if (terminal.includes(order?.shipment?.status)) {
//     throw new Error(`Cannot book shipment when shipment.status is ${order.shipment.status}`);
//   }
//   if (terminal.includes(order?.fulfillmentStatus)) {
//     throw new Error(`Cannot book shipment when fulfillmentStatus is ${order.fulfillmentStatus}`);
//   }

//   const existingAwb = safeTrim(order?.shipment?.xpressbees?.awb);
//   if (existingAwb && !force) {
//     return {
//       ok: true,
//       skipped: true,
//       message: "Shipment already created (AWB exists).",
//       awb: existingAwb,
//       shipmentId: safeTrim(order?.shipment?.xpressbees?.shipmentId),
//       labelUrl: safeTrim(order?.shipment?.xpressbees?.labelUrl),
//     };
//   }

//   // 1) AWB series
//   const awbSeriesPayload = mapOrderToAwbSeriesPayload(order);

//   let seriesRaw = await callAwbSeries(
//     XPRESSBEES_API.AWB_NUMBER_SERIES_GENERATION,
//     awbSeriesPayload,
//     { withHeaders: true }
//   );

//   assertAwbSeriesOk(seriesRaw, awbSeriesPayload);

//   // Try direct extraction first
//   let awb = pickFirstAwbFromSeriesResponse(seriesRaw);

//   // If no AWB, try via BatchID lookup
//   if (!awb) {
//     const batchId = safeTrim(seriesRaw?.BatchID || seriesRaw?.data?.BatchID || "");
//     if (batchId) {
//       const batchRaw = await fetchAwbFromBatch({ batchId, awbSeriesPayload });
//       awb = pickFirstAwbFromSeriesResponse(batchRaw);

//       if (!awb) {
//         throw new Error(
//           "XB AWB series succeeded but AWB not found even after BatchID fetch. " +
//             "BatchID: " +
//             batchId +
//             " BatchResponse: " +
//             JSON.stringify(batchRaw, null, 2)
//         );
//       }

//       // Keep for debugging
//       seriesRaw = { seriesRaw, batchRaw };
//     } else {
//       throw new Error(
//         "XB AWB series succeeded but AWB missing and BatchID not provided. Response: " +
//           JSON.stringify(seriesRaw, null, 2)
//       );
//     }
//   }

//   // 2) Forward manifest
//   const forwardPayload = mapOrderToForwardManifestPayload(order, { awb });
//   const forwardRaw = await xbFetch(XPRESSBEES_API.FORWARD_MANIFEST, {
//     method: "POST",
//     body: forwardPayload,
//   });

//   // Save in order
//   order.shipment = order.shipment || {};
//   order.shipment.provider = "xpressbees";
//   order.shipment.xpressbees = order.shipment.xpressbees || {};

//   order.shipment.xpressbees.awb = awb;
//   order.shipment.xpressbees.shipmentId = safeTrim(
//     forwardRaw?.shipmentId || forwardRaw?.data?.shipmentId || ""
//   );
//   order.shipment.xpressbees.labelUrl = safeTrim(
//     forwardRaw?.labelUrl || forwardRaw?.data?.labelUrl || ""
//   );
//   order.shipment.xpressbees.courierName = "XpressBees";
//   order.shipment.xpressbees.lastTrack = null;
//   order.shipment.xpressbees.lastWebhook = null;

//   order.trackingDetails = order.trackingDetails || {};
//   order.trackingDetails.trackingId = awb;
//   order.trackingDetails.courierName = "XpressBees";

//   order.shipment.status = "processing";
//   if (!order.fulfillmentStatus || order.fulfillmentStatus === "processing") {
//     order.fulfillmentStatus = "packed";
//   }
//   order.shipment.shippedAt = order.shipment.shippedAt || new Date();

//   await order.save();

//   return {
//     ok: true,
//     message: "XpressBees booking done (AWB generated + forward manifest).",
//     awb,
//     seriesRaw,
//     forwardRaw,
//   };
// }

// // ----------------------------------------------------------
// // Tracking
// // ----------------------------------------------------------
// export async function trackByAwb(awb) {
//   awb = safeTrim(awb);
//   if (!awb) throw new Error("awb is required");

//   const payload = mapAwbTrackingSummaryPayload({ awb });
//   const raw = await xbFetch(XPRESSBEES_API.TRACKING_SUMMARY, {
//     method: "POST",
//     body: payload,
//   });

//   const statusCode =
//     raw?.status_code ||
//     raw?.current_status_code ||
//     raw?.status ||
//     raw?.current_status ||
//     raw?.data?.status_code ||
//     raw?.data?.current_status_code ||
//     raw?.data?.status ||
//     raw?.result?.status ||
//     raw?.result?.status_code;

//   const timeline =
//     raw?.history ||
//     raw?.events ||
//     raw?.tracking_history ||
//     raw?.data?.history ||
//     raw?.data?.events ||
//     raw?.result?.history ||
//     [];

//   return { raw, statusCode, timeline };
// }

// export async function trackBulkByAwbs(awbs = []) {
//   if (!Array.isArray(awbs) || awbs.length === 0) throw new Error("awbs array required");
//   const payload = mapAwbTrackingBulkPayload({ awbs });
//   const raw = await xbFetch(XPRESSBEES_API.TRACKING_BULK, { method: "POST", body: payload });
//   return { raw };
// }

// export async function syncTrackingForOrder(orderId) {
//   const order = await Order.findById(orderId);
//   if (!order) throw new Error("Order not found");

//   const awb =
//     safeTrim(order?.shipment?.xpressbees?.awb) || safeTrim(order?.trackingDetails?.trackingId);
//   if (!awb) throw new Error("No AWB found for order");

//   const { statusCode, timeline, raw } = await trackByAwb(awb);
//   const mapped = mapXpressbeesStatus(statusCode);

//   order.shipment = order.shipment || {};
//   order.shipment.provider = "xpressbees";
//   order.shipment.status = mapped.shipmentStatus;
//   order.fulfillmentStatus = mapped.fulfillmentStatus;

//   if (mapped.shipmentStatus === "delivered") {
//     order.shipment.deliveredAt ||= new Date();
//     order.trackingDetails ||= {};
//     order.trackingDetails.deliveredAt ||= new Date();
//   }

//   order.shipment.xpressbees ||= {};
//   order.shipment.xpressbees.lastTrack = raw;

//   await order.save();

//   return { ok: true, awb, statusCode, mapped, timelineCount: timeline.length };
// }

// export async function cancelShipment(awb, opts = {}) {
//   awb = safeTrim(awb);
//   if (!awb) throw new Error("awb is required");

//   const payload = mapRtoCancelPayload({ awb, ...opts });
//   const raw = await xbFetch(XPRESSBEES_API.RTO_NOTIFY_SHIPMENT, { method: "POST", body: payload });
//   return { ok: true, raw };
// }
