// cronjob/shiprocket/testShipmentTrackDryRun.js
// ✅ Dry-run tester: Track Shiprocket status using Shipment ID (NO DB update)

import "dotenv/config";
import axios from "axios";
import {
  mapShiprocketToLocal,
  extractShiprocketStatus,
  BEFORE_OFD,
  BLOCKED_FROM_CRON,
  shouldUpdateStatus,
} from "./shiprocketStatusMap.js";

const { SHIPROCKET_TOKEN } = process.env;

if (!SHIPROCKET_TOKEN) {
  console.error("❌ Missing SHIPROCKET_TOKEN in env");
  process.exit(1);
}

/* =============================
   TEST INPUT (paste your order JSON here)
============================= */
const ORDER = {
  _id: "6998ac11e0d7f08022776615",
  orderNumber: "MIRAY-000420",
  fulfillmentStatus: "shipped",
  shipment: {
    provider: "shiprocket",
    status: "processing",
    shiprocket: {
      orderId: "1202141565",
      shipmentId: "1198452735",
      awb: "",
      courierName: "",
      trackingUrl: "",
    },
  },
  trackingDetails: { trackingId: "", courierName: "", trackingUrl: "" },
};

/* =============================
   Helpers
============================= */
const norm = (v) => String(v || "").trim();
const safeJson = (obj) => {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
};

async function trackByShipmentId(shipmentId) {
  const url = `https://apiv2.shiprocket.in/v1/external/courier/track/shipment/${encodeURIComponent(
    shipmentId
  )}`;

  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${SHIPROCKET_TOKEN}` },
    timeout: 20000,
  });

  return res.data;
}

/* =============================
   Dry Run Logic
============================= */
async function main() {
  const sr = ORDER?.shipment?.shiprocket || {};
  const shipmentId = sr?.shipmentId;

  if (!shipmentId) {
    console.log("⏭️ No shipmentId found in ORDER.shipment.shiprocket.shipmentId");
    return;
  }

  console.log("🔎 DRY RUN: Shiprocket tracking by shipmentId");
  console.log(`📦 Order: ${ORDER.orderNumber}`);
  console.log(`   shipmentId: ${shipmentId}`);
  console.log(`   orderId   : ${sr?.orderId || ""}`);
  console.log(`   awb       : ${sr?.awb || ""}`);
  console.log("");

  // local current statuses
  const currentFulfillment = norm(ORDER?.fulfillmentStatus || "processing");
  const currentShipmentStatus = norm(ORDER?.shipment?.status || "processing");

  console.log("🏷️ Current Local Status:");
  console.log(`   fulfillmentStatus: ${currentFulfillment}`);
  console.log(`   shipment.status  : ${currentShipmentStatus}`);
  console.log("");

  // blocked?
  if (BLOCKED_FROM_CRON.has(currentFulfillment)) {
    console.log(`⛔ BLOCKED_FROM_CRON: current fulfillmentStatus "${currentFulfillment}"`);
    return;
  }

  // fetch from Shiprocket
  let payload;
  try {
    payload = await trackByShipmentId(shipmentId);
  } catch (err) {
    const data = err?.response?.data || null;
    const msg = data ? safeJson(data) : err?.message || String(err);
    console.error(`❌ Track failed for shipmentId=${shipmentId}:\n${msg}`);
    return;
  }

  // extract + map
  const srStatusRaw = extractShiprocketStatus(payload);
  const nextStatus = norm(mapShiprocketToLocal(srStatusRaw));

  console.log("📡 Shiprocket Status:");
  console.log(`   raw   : ${srStatusRaw}`);
  console.log(`   mapped: ${nextStatus}`);
  console.log("");

  // explain eligibility
  const allowedLocalUpdates = new Set(["out_for_delivery", "delivered"]);
  const isAllowed = allowedLocalUpdates.has(nextStatus);

  const isEligibleProgression =
    (BEFORE_OFD.has(currentFulfillment) &&
      (nextStatus === "out_for_delivery" || nextStatus === "delivered")) ||
    (currentFulfillment === "out_for_delivery" && nextStatus === "delivered");

  const noDowngrade = shouldUpdateStatus(currentFulfillment, nextStatus);

  console.log("🧪 Gates:");
  console.log(`   ALLOWED_LOCAL_UPDATES?     ${isAllowed}`);
  console.log(`   BEFORE_OFD has current?    ${BEFORE_OFD.has(currentFulfillment)}`);
  console.log(`   Eligible progression?      ${isEligibleProgression}`);
  console.log(`   shouldUpdateStatus()?      ${noDowngrade}`);
  console.log("");

  // final decision (dry run)
  if (!isAllowed) {
    console.log("✅ DRY RESULT: SKIP (Reason: NOT_ALLOWED_LOCAL_UPDATE)");
    return;
  }
  if (!isEligibleProgression) {
    console.log("✅ DRY RESULT: SKIP (Reason: NOT_ELIGIBLE_PROGRESSION)");
    return;
  }
  if (!noDowngrade) {
    console.log("✅ DRY RESULT: SKIP (Reason: SHOULD_UPDATE_FALSE)");
    return;
  }

  // what would update
  console.log("✅ DRY RESULT: WOULD UPDATE DB");
  console.log(`   fulfillmentStatus: ${currentFulfillment} -> ${nextStatus}`);
  console.log(`   shipment.status  : ${currentShipmentStatus} -> ${nextStatus}`);
  console.log("");

  // optional: show key fields from payload
  const td =
    payload?.tracking_data ||
    payload?.trackingData ||
    payload?.data?.tracking_data ||
    {};

  console.log("📦 Tracking payload highlights:");
  console.log(`   courier_name: ${td?.courier_name || ""}`);
  console.log(`   track_url   : ${td?.track_url || ""}`);
  console.log(`   shipment_status: ${td?.shipment_status ?? ""}`);
  console.log(`   shipment_status_description: ${td?.shipment_status_description || ""}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });

/*
RUN:
  node cronjob/shiprocket/testShipmentTrackDryRun.js

NOTES:
- This script DOES NOT touch MongoDB
- It only calls Shiprocket tracking API using shipmentId
- It tells you exactly why it would SKIP/UPDATE
*/