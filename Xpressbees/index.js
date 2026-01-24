// Xpressbees/index.js

// ✅ Services
export * from "./xpressbees.service.js";

// ✅ Mapper exports (new flow)
export {
  mapOrderToAwbSeriesPayload,
  mapOrderToForwardManifestPayload,
  mapAwbTrackingSummaryPayload,
  mapAwbTrackingBulkPayload,
  mapRtoCancelPayload,
} from "./xpressbees.mapper.js";

// ✅ Client export (new xbFetch wrapper)
export { xbFetch } from "./xpressbees.client.js";

// ✅ Webhook exports
export { handleXpressbeesWebhook, extractWebhookFields } from "./xpressbees.webhook.js";

// ✅ Webhook URL (your hosted backend)
export const XPRESSBEES_WEBHOOK_URL =
  "https://error.mirayfashions.com/api/webhooks/xpressbees";
