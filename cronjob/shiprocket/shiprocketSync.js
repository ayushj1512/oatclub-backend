// cronjob/shiprocket/shiprocketSync.js
import "dotenv/config";
import mongoose from "mongoose";
import axios from "axios";
import Order from "../../Orders/Orders.js";
import {
  mapShiprocketToLocal,
  extractShiprocketStatus,
  shouldUpdateStatus,
  BEFORE_OFD,
  BLOCKED_FROM_CRON,
} from "./shiprocketStatusMap.js";

const { MONGO_URI, SHIPROCKET_TOKEN } = process.env;

/* =============================
   CONFIG
============================= */
const DEBUG_PRINT_RAW_PAYLOAD = false;
const RAW_PAYLOAD_PRINT_LIMIT = 2;

// ✅ Print status line for every order (recommended for this dry run)
const DEBUG_PRINT_EACH_ORDER = true;

// ✅ Print skip reason lines (limited)
const DEBUG_SKIP_LIMIT = 500;

// ✅ Dry run: do NOT write to DB (timing + logic test)
const DRY_RUN = false;

// Optional: limit orders processed (for timing)
const MAX_ORDERS = 0; // 0 = no limit

// Axios timeout
const TRACK_TIMEOUT_MS = 20000;

/**
 * ✅ Only allow these status updates from this cron.
 */
const ALLOWED_LOCAL_UPDATES = new Set(["out_for_delivery", "delivered"]);

/* =============================
   Helpers
============================= */
async function trackByShipmentId(shipmentId) {
  const url = `https://apiv2.shiprocket.in/v1/external/courier/track/shipment/${encodeURIComponent(
    shipmentId
  )}`;

  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${SHIPROCKET_TOKEN}` },
    timeout: TRACK_TIMEOUT_MS,
  });

  return res.data;
}

function safeJson(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function isShippedLike(status) {
  return ["shipped", "out_for_delivery", "delivered", "rto"].includes(String(status || ""));
}

const norm = (v) => String(v || "").trim();
const lower = (v) => String(v || "").toLowerCase();

function nowMs() {
  return Date.now();
}

/* =============================
   Debug helpers
============================= */
let skipDebugPrinted = 0;

function debugOrderLine({
  orderNumber,
  shipmentId,
  currentFulfillment,
  currentShipmentStatus,
  srStatusRaw,
  nextStatus,
  decision,
  reason,
}) {
  if (!DEBUG_PRINT_EACH_ORDER) return;

  const parts = [
    `📦 ${orderNumber}`,
    `shipmentId=${shipmentId || ""}`,
    `cur=${currentFulfillment}/${currentShipmentStatus}`,
    `sr="${srStatusRaw}"`,
    `map=${nextStatus}`,
    `=> ${decision}${reason ? ` (${reason})` : ""}`,
  ];

  console.log(parts.join(" | "));
}

function debugSkip(order, reason, extra = {}) {
  if (skipDebugPrinted >= DEBUG_SKIP_LIMIT) return;
  skipDebugPrinted++;

  const shipmentId = order?.shipment?.shiprocket?.shipmentId;

  debugOrderLine({
    orderNumber: order?.orderNumber,
    shipmentId,
    currentFulfillment: norm(order?.fulfillmentStatus || "processing"),
    currentShipmentStatus: norm(order?.shipment?.status || "processing"),
    srStatusRaw: extra?.srStatusRaw ?? "",
    nextStatus: extra?.nextStatus ?? "",
    decision: "SKIP",
    reason,
  });
}

/* =============================
   Main runner
============================= */
async function run() {
  if (!MONGO_URI) throw new Error("Missing MONGO_URI in env");
  if (!SHIPROCKET_TOKEN) throw new Error("Missing SHIPROCKET_TOKEN in env");

  console.log("🔧 ENV CHECK:", {
    MONGO_URI: "✅ set",
    SHIPROCKET_TOKEN: "✅ set",
    DRY_RUN,
    DEBUG_PRINT_EACH_ORDER,
    MAX_ORDERS: MAX_ORDERS || "no limit",
  });

  await mongoose.connect(MONGO_URI);
  console.log("✅ Mongo connected:", {
    db: mongoose.connection?.name,
    host: mongoose.connection?.host,
  });

  const t0 = nowMs();

  try {
    // ✅ candidates: confirmed + shiprocket + shipmentId + not final + NOT RMA states
    const query = {
      isConfirmed: true,
      "shipment.provider": "shiprocket",
      "shipment.shiprocket.shipmentId": { $exists: true, $ne: "" },

      // Do not even fetch orders that are in final/RMA lifecycle
      fulfillmentStatus: {
        $nin: [
          "delivered",
          "cancelled",
          "rto",
          "return_requested",
          "exchange_requested",
          "returned",
        ],
      },
    };

    const ordersAll = await Order.find(query).select(
      "_id orderNumber orderType isConfirmed fulfillmentStatus shipment trackingDetails"
    );

    const orders = MAX_ORDERS && MAX_ORDERS > 0 ? ordersAll.slice(0, MAX_ORDERS) : ordersAll;

    console.log(`📦 Shiprocket Sync: found ${ordersAll.length} candidate orders`);
    if (orders.length !== ordersAll.length) {
      console.log(`🧪 Limiting to ${orders.length} orders (MAX_ORDERS) for dry-run/timing`);
    }

    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let rawPrinted = 0;

    // timing stats
    let apiCalls = 0;
    let apiMsTotal = 0;

    for (const order of orders) {
      const shipmentId = order?.shipment?.shiprocket?.shipmentId;

      if (!shipmentId) {
        skipped++;
        debugSkip(order, "NO_SHIPMENT_ID");
        continue;
      }

      const currentFulfillment = norm(order.fulfillmentStatus || "processing");
      const currentShipmentStatus = norm(order?.shipment?.status || "processing");

      // ✅ HARD GATE 0: never touch RMA/return/exchange/cancel/rto etc
      if (BLOCKED_FROM_CRON.has(currentFulfillment)) {
        skipped++;
        debugSkip(order, "BLOCKED_FROM_CRON_CURRENT_STATUS");
        continue;
      }

      try {
        const apiT0 = nowMs();
        const payload = await trackByShipmentId(shipmentId);
        const apiT1 = nowMs();

        apiCalls++;
        apiMsTotal += apiT1 - apiT0;

        if (DEBUG_PRINT_RAW_PAYLOAD && rawPrinted < RAW_PAYLOAD_PRINT_LIMIT) {
          console.log(`📡 RAW PAYLOAD for ${order.orderNumber} (shipmentId=${shipmentId}):`);
          console.log(safeJson(payload));
          rawPrinted++;
        }

        const srStatusRaw = extractShiprocketStatus(payload);
        const nextStatus = norm(mapShiprocketToLocal(srStatusRaw));

        // ✅ HARD GATE 1: only OFD/Delivered can be written
        if (!ALLOWED_LOCAL_UPDATES.has(nextStatus)) {
          skipped++;
          debugOrderLine({
            orderNumber: order.orderNumber,
            shipmentId,
            currentFulfillment,
            currentShipmentStatus,
            srStatusRaw,
            nextStatus,
            decision: "SKIP",
            reason: "NOT_ALLOWED_LOCAL_UPDATE",
          });
          continue;
        }

        // ✅ HARD GATE 3:
        // Only move "before OFD" statuses to OFD/Delivered,
        // plus allow OFD -> Delivered.
        const isEligibleProgression =
          (BEFORE_OFD.has(currentFulfillment) &&
            (nextStatus === "out_for_delivery" || nextStatus === "delivered")) ||
          (currentFulfillment === "out_for_delivery" && nextStatus === "delivered");

        if (!isEligibleProgression) {
          skipped++;
          debugOrderLine({
            orderNumber: order.orderNumber,
            shipmentId,
            currentFulfillment,
            currentShipmentStatus,
            srStatusRaw,
            nextStatus,
            decision: "SKIP",
            reason: `NOT_ELIGIBLE_PROGRESSION (BEFORE_OFD=${BEFORE_OFD.has(currentFulfillment)})`,
          });
          continue;
        }

        // ✅ No downgrades (extra safety)
        if (!shouldUpdateStatus(currentFulfillment, nextStatus)) {
          skipped++;
          debugOrderLine({
            orderNumber: order.orderNumber,
            shipmentId,
            currentFulfillment,
            currentShipmentStatus,
            srStatusRaw,
            nextStatus,
            decision: "SKIP",
            reason: "SHOULD_UPDATE_FALSE",
          });
          continue;
        }

        // no change
        if (currentFulfillment === nextStatus && currentShipmentStatus === nextStatus) {
          skipped++;
          debugOrderLine({
            orderNumber: order.orderNumber,
            shipmentId,
            currentFulfillment,
            currentShipmentStatus,
            srStatusRaw,
            nextStatus,
            decision: "SKIP",
            reason: "NO_CHANGE",
          });
          continue;
        }

        // build update
        const $set = {
          "shipment.status": nextStatus,
          fulfillmentStatus: nextStatus,

          // ✅ store visibility fields
          "shipment.shiprocket.lastStatusRaw": String(srStatusRaw || ""),
          "shipment.shiprocket.lastStatusMapped": nextStatus,
          "shipment.shiprocket.lastSyncAt": new Date(),
        };

        // optional courier/tracking url
        const td =
          payload?.tracking_data ||
          payload?.trackingData ||
          payload?.data?.tracking_data ||
          {};

        if (td?.courier_name) $set["shipment.shiprocket.courierName"] = td.courier_name;
        if (td?.track_url) $set["shipment.shiprocket.trackingUrl"] = td.track_url;

        const now = new Date();

        // If OFD/Delivered comes and shippedAt missing, set it
        if (isShippedLike(nextStatus) && !order?.shipment?.shippedAt) {
          $set["shipment.shippedAt"] = now;
          $set["trackingDetails.shippedAt"] = now;
        }

        // delivered timestamps
        if (nextStatus === "delivered") {
          if (!order?.shipment?.deliveredAt) $set["shipment.deliveredAt"] = now;
          if (!order?.trackingDetails?.deliveredAt) $set["trackingDetails.deliveredAt"] = now;
        }

        if (!DRY_RUN) {
          await Order.updateOne({ _id: order._id }, { $set });
        }

        updated++;

        debugOrderLine({
          orderNumber: order.orderNumber,
          shipmentId,
          currentFulfillment,
          currentShipmentStatus,
          srStatusRaw,
          nextStatus,
          decision: DRY_RUN ? "WOULD_UPDATE" : "UPDATED",
          reason: DRY_RUN ? "DRY_RUN" : "",
        });
      } catch (err) {
        failed++;

        const data = err?.response?.data || null;
        const message = String(data?.message || err?.message || "");
        const msgLower = lower(message);

        // Shiprocket cancelled (some endpoints return 500 for cancelled shipments too)
        if (msgLower.includes("cancelled")) {
          skipped++;

          debugOrderLine({
            orderNumber: order.orderNumber,
            shipmentId,
            currentFulfillment,
            currentShipmentStatus,
            srStatusRaw: "",
            nextStatus: "",
            decision: "SKIP",
            reason: "CANCELLED_AT_SHIPROCKET",
          });

          if (!DRY_RUN) {
            try {
              await Order.updateOne(
                { _id: order._id },
                {
                  $set: {
                    "shipment.shiprocket.isShipmentCancelled": true,
                    "shipment.shiprocket.shipmentCancelledAt": new Date(),
                    "shipment.shiprocket.lastTrackError": data?.message || "cancelled",
                    "shipment.shiprocket.lastSyncAt": new Date(),
                  },
                }
              );
            } catch {}
          }

          continue;
        }

        const msg = data ? safeJson(data) : err?.message || String(err);
        console.error(`❌ ${order.orderNumber} (shipmentId=${shipmentId}) failed:\n${msg}`);
      }
    }

    const t1 = nowMs();
    const totalMs = t1 - t0;
    const avgApi = apiCalls ? Math.round(apiMsTotal / apiCalls) : 0;

    console.log(
      `✅ Shiprocket Sync done. Updated: ${updated}/${orders.length} | Skipped: ${skipped} | Failed: ${failed}`
    );
    console.log("⏱️ Timing:", {
      totalMs,
      totalSec: Math.round(totalMs / 1000),
      apiCalls,
      avgApiMs: avgApi,
    });
  } finally {
    try {
      await mongoose.disconnect();
      console.log("✅ Mongo disconnected");
    } catch (e) {
      console.error("⚠️ Mongo disconnect failed:", e?.message || e);
    }
  }
}

/**
 * ✅ Export for in-app cron (IMPORT SAFE)
 */
export async function runShiprocketSync() {
  await run();
}

/**
 * ✅ CLI mode (manual run):
 * node cronjob/shiprocket/shiprocketSync.js
 */
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv?.[1] &&
  process.argv[1].replaceAll("\\", "/").endsWith("/shiprocketSync.js");

if (isDirectRun) {
  run()
    .then(() => console.log("✅ Shiprocket Sync finished"))
    .catch((e) => {
      console.error("Fatal:", e);
      process.exit(1);
    });
}