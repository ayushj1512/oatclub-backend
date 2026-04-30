// cronjob/shiprocket/shiprocketSync.js
import "dotenv/config";

import dns from "node:dns";
import mongoose from "mongoose";
import axios from "axios";

import Order from "../../Orders/Orders.js";
import { getShiprocketToken } from "../../shiprocket/shiprocket.auth.js";
import {
  mapShiprocketToLocal,
  extractShiprocketStatus,
  shouldUpdateStatus,
  BEFORE_OFD,
  BLOCKED_FROM_CRON,
} from "./shiprocketStatusMap.js";

const { MONGO_URI } = process.env;

/* =============================
   DNS FIX
============================= */
dns.setServers(["1.1.1.1", "8.8.8.8"]);

/* =============================
   CONFIG
============================= */
const DEBUG_PRINT_RAW_PAYLOAD = false;
const RAW_PAYLOAD_PRINT_LIMIT = 2;
const DEBUG_PRINT_EACH_ORDER = false;
const DEBUG_SKIP_LIMIT = 500;

// ✅ Dry run enabled for testing
const DRY_RUN = false;

const MAX_ORDERS = 0;
const TRACK_TIMEOUT_MS = 20000;

const ALLOWED_LOCAL_UPDATES = new Set(["out_for_delivery", "delivered"]);

const REQUEST_GAP_MS = 500;
const MAX_RETRIES_ON_429 = 3;
const RETRY_BASE_DELAY_MS = 60000;

/* =============================
   Helpers
============================= */
const norm = (v) => String(v || "").trim();
const lower = (v) => String(v || "").toLowerCase();

const nowMs = () => Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeJson(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function isShippedLike(status) {
  return ["shipped", "out_for_delivery", "delivered", "rto"].includes(
    String(status || "")
  );
}

function isRateLimitError(err) {
  return Number(err?.response?.status) === 429;
}

function isAuthError(err) {
  const status = Number(err?.response?.status);
  const msg = lower(JSON.stringify(err?.response?.data || err?.message || ""));

  return (
    status === 401 ||
    status === 403 ||
    msg.includes("token") ||
    msg.includes("unauthorized") ||
    msg.includes("unauthenticated")
  );
}

function getRetryDelayMs(attemptNumber) {
  return RETRY_BASE_DELAY_MS * attemptNumber;
}

function extractTrackingData(payload) {
  return (
    payload?.tracking_data ||
    payload?.trackingData ||
    payload?.data?.tracking_data ||
    {}
  );
}

function buildCandidateQuery() {
  return {
    isConfirmed: true,
    "shipment.provider": "shiprocket",
    "shipment.shiprocket.shipmentId": { $exists: true, $ne: "" },
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
}

/* =============================
   Shiprocket helpers
============================= */
async function trackByShipmentId(shipmentId, { forceToken = false } = {}) {
  const token = await getShiprocketToken({ force: forceToken });

  const url = `https://apiv2.shiprocket.in/v1/external/courier/track/shipment/${encodeURIComponent(
    shipmentId
  )}`;

  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    timeout: TRACK_TIMEOUT_MS,
  });

  return res.data;
}

async function trackByShipmentIdWithRetry(shipmentId) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES_ON_429 + 1; attempt++) {
    try {
      return await trackByShipmentId(shipmentId);
    } catch (err) {
      lastError = err;

      if (isAuthError(err)) {
        console.warn(`🔐 Auth error for shipmentId=${shipmentId}. Retrying once with fresh token...`);
        return await trackByShipmentId(shipmentId, { forceToken: true });
      }

      if (!isRateLimitError(err) || attempt > MAX_RETRIES_ON_429) {
        throw err;
      }

      const delayMs = getRetryDelayMs(attempt);

      console.warn(
        `⏳ Rate limited for shipmentId=${shipmentId}. Retry ${attempt}/${MAX_RETRIES_ON_429} in ${delayMs}ms`
      );

      await sleep(delayMs);
    }
  }

  throw lastError;
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

  console.log(
    [
      `📦 ${orderNumber}`,
      `shipmentId=${shipmentId || ""}`,
      `cur=${currentFulfillment}/${currentShipmentStatus}`,
      `sr="${srStatusRaw}"`,
      `map=${nextStatus}`,
      `=> ${decision}${reason ? ` (${reason})` : ""}`,
    ].join(" | ")
  );
}

function debugSkip(order, reason, extra = {}) {
  if (skipDebugPrinted >= DEBUG_SKIP_LIMIT) return;
  skipDebugPrinted++;

  debugOrderLine({
    orderNumber: order?.orderNumber,
    shipmentId: order?.shipment?.shiprocket?.shipmentId,
    currentFulfillment: norm(order?.fulfillmentStatus || "processing"),
    currentShipmentStatus: norm(order?.shipment?.status || "processing"),
    srStatusRaw: extra?.srStatusRaw ?? "",
    nextStatus: extra?.nextStatus ?? "",
    decision: "SKIP",
    reason,
  });
}

/* =============================
   DB helpers
============================= */
async function connectDB() {
  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });

  console.log("✅ Mongo connected:", {
    db: mongoose.connection?.name,
    host: mongoose.connection?.host,
  });
}

async function disconnectDB() {
  try {
    await mongoose.disconnect();
    console.log("✅ Mongo disconnected");
  } catch (e) {
    console.error("⚠️ Mongo disconnect failed:", e?.message || e);
  }
}

/* =============================
   Per-order processor
============================= */
async function processOrder(order, context) {
  const { counters } = context;
  const shipmentId = order?.shipment?.shiprocket?.shipmentId;

  if (!shipmentId) {
    counters.skipped++;
    debugSkip(order, "NO_SHIPMENT_ID");
    return;
  }

  const currentFulfillment = norm(order?.fulfillmentStatus || "processing");
  const currentShipmentStatus = norm(order?.shipment?.status || "processing");

  if (BLOCKED_FROM_CRON.has(currentFulfillment)) {
    counters.skipped++;
    debugSkip(order, "BLOCKED_FROM_CRON_CURRENT_STATUS");
    return;
  }

  try {
    if (REQUEST_GAP_MS > 0) await sleep(REQUEST_GAP_MS);

    const apiT0 = nowMs();
    const payload = await trackByShipmentIdWithRetry(shipmentId);
    const apiT1 = nowMs();

    counters.apiCalls++;
    counters.apiMsTotal += apiT1 - apiT0;

    if (
      DEBUG_PRINT_RAW_PAYLOAD &&
      counters.rawPrinted < RAW_PAYLOAD_PRINT_LIMIT
    ) {
      console.log(`📡 RAW PAYLOAD for ${order.orderNumber} (${shipmentId}):`);
      console.log(safeJson(payload));
      counters.rawPrinted++;
    }

    const srStatusRaw = extractShiprocketStatus(payload);
    const nextStatus = norm(mapShiprocketToLocal(srStatusRaw));

    if (!ALLOWED_LOCAL_UPDATES.has(nextStatus)) {
      counters.skipped++;
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
      return;
    }

    const isEligibleProgression =
      (BEFORE_OFD.has(currentFulfillment) &&
        (nextStatus === "out_for_delivery" || nextStatus === "delivered")) ||
      (currentFulfillment === "out_for_delivery" &&
        nextStatus === "delivered");

    if (!isEligibleProgression) {
      counters.skipped++;
      debugOrderLine({
        orderNumber: order.orderNumber,
        shipmentId,
        currentFulfillment,
        currentShipmentStatus,
        srStatusRaw,
        nextStatus,
        decision: "SKIP",
        reason: `NOT_ELIGIBLE_PROGRESSION`,
      });
      return;
    }

    if (!shouldUpdateStatus(currentFulfillment, nextStatus)) {
      counters.skipped++;
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
      return;
    }

    if (
      currentFulfillment === nextStatus &&
      currentShipmentStatus === nextStatus
    ) {
      counters.skipped++;
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
      return;
    }

    const now = new Date();

    const $set = {
      "shipment.status": nextStatus,
      fulfillmentStatus: nextStatus,
      "shipment.shiprocket.lastStatusRaw": String(srStatusRaw || ""),
      "shipment.shiprocket.lastStatusMapped": nextStatus,
      "shipment.shiprocket.lastSyncAt": now,
    };

    const td = extractTrackingData(payload);

    if (td?.courier_name) {
      $set["shipment.shiprocket.courierName"] = td.courier_name;
    }

    if (td?.track_url) {
      $set["shipment.shiprocket.trackingUrl"] = td.track_url;
    }

    if (isShippedLike(nextStatus) && !order?.shipment?.shippedAt) {
      $set["shipment.shippedAt"] = now;
      $set["trackingDetails.shippedAt"] = now;
    }

    if (nextStatus === "delivered") {
      if (!order?.shipment?.deliveredAt) {
        $set["shipment.deliveredAt"] = now;
      }

      if (!order?.trackingDetails?.deliveredAt) {
        $set["trackingDetails.deliveredAt"] = now;
      }
    }

    if (!DRY_RUN) {
      await Order.updateOne({ _id: order._id }, { $set });
    }

    counters.updated++;

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
    const data = err?.response?.data || null;
    const message = String(data?.message || err?.message || "");
    const msgLower = lower(message);

    if (msgLower.includes("cancelled")) {
      counters.skipped++;

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
                "shipment.shiprocket.lastTrackError":
                  data?.message || "cancelled",
                "shipment.shiprocket.lastSyncAt": new Date(),
              },
            }
          );
        } catch {}
      }

      return;
    }

    counters.failed++;

    const msg = data ? safeJson(data) : err?.message || String(err);
    console.error(`❌ ${order.orderNumber} (${shipmentId}) failed:\n${msg}`);
  }
}

/* =============================
   Main runner
============================= */
async function run() {
  if (!MONGO_URI) throw new Error("Missing MONGO_URI in env");

  if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) {
    throw new Error("Missing SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD in env");
  }

  console.log("🔧 ENV CHECK:", {
    MONGO_URI: "✅ set",
    SHIPROCKET_EMAIL: process.env.SHIPROCKET_EMAIL ? "✅ set" : "❌ missing",
    SHIPROCKET_PASSWORD: process.env.SHIPROCKET_PASSWORD
      ? "✅ set"
      : "❌ missing",
    DRY_RUN,
    DEBUG_PRINT_EACH_ORDER,
    MAX_ORDERS: MAX_ORDERS || "no limit",
    REQUEST_GAP_MS,
    MAX_RETRIES_ON_429,
    RETRY_BASE_DELAY_MS,
  });

  await connectDB();

  const t0 = nowMs();

  try {
    const query = buildCandidateQuery();

    const ordersAll = await Order.find(query).select(
      "_id orderNumber orderType isConfirmed fulfillmentStatus shipment trackingDetails"
    );

    const orders =
      MAX_ORDERS && MAX_ORDERS > 0 ? ordersAll.slice(0, MAX_ORDERS) : ordersAll;

    console.log(`📦 Shiprocket Sync: found ${ordersAll.length} candidate orders`);

    if (orders.length !== ordersAll.length) {
      console.log(`🧪 Limiting to ${orders.length} orders`);
    }

    const counters = {
      updated: 0,
      skipped: 0,
      failed: 0,
      rawPrinted: 0,
      apiCalls: 0,
      apiMsTotal: 0,
    };

    for (const order of orders) {
      await processOrder(order, { counters });
    }

    const totalMs = nowMs() - t0;
    const avgApiMs = counters.apiCalls
      ? Math.round(counters.apiMsTotal / counters.apiCalls)
      : 0;

    console.log(
      `✅ Shiprocket Sync done. Updated: ${counters.updated}/${orders.length} | Skipped: ${counters.skipped} | Failed: ${counters.failed}`
    );

    console.log("⏱️ Timing:", {
      totalMs,
      totalSec: Math.round(totalMs / 1000),
      apiCalls: counters.apiCalls,
      avgApiMs,
    });
  } finally {
    await disconnectDB();
  }
}

/* =============================
   Export / CLI
============================= */
export async function runShiprocketSync() {
  await run();
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv?.[1] &&
  process.argv[1].replaceAll("\\", "/").endsWith("/shiprocketSync.js");

if (isDirectRun) {
  run()
    .then(() => console.log("✅ Shiprocket Sync finished"))
    .catch((e) => {
      console.error("Fatal:", e?.message || e);
      process.exit(1);
    });
}