import "dotenv/config";
import mongoose from "mongoose";
import axios from "axios";
import Order from "../../Orders/Orders.js";
import {
  mapShiprocketToLocal,
  extractShiprocketStatus,
  shouldUpdateStatus,
} from "./shiprocketStatusMap.js";

const { MONGO_URI, SHIPROCKET_TOKEN } = process.env;

/* =============================
   CONFIG
============================= */
const DEBUG_PRINT_RAW_PAYLOAD = false;
const RAW_PAYLOAD_PRINT_LIMIT = 2;

/**
 * ✅ IMPORTANT:
 * Only allow these status updates from this cron.
 * packed/shipped/picked etc will NEVER be written by this script.
 */
const ALLOWED_LOCAL_UPDATES = new Set(["out_for_delivery", "delivered"]);

/* =============================
   Helpers
============================= */
async function trackByAwb(awb) {
  const url = `https://apiv2.shiprocket.in/v1/external/courier/track/awb/${encodeURIComponent(
    awb
  )}`;

  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${SHIPROCKET_TOKEN}` },
    timeout: 20000,
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
  return ["shipped", "out_for_delivery", "delivered", "rto"].includes(
    String(status || "")
  );
}

/* =============================
   Main runner
============================= */
async function run() {
  // ✅ IMPORTANT: Never kill the whole backend process from an imported cron file
  // If env missing, just throw; caller (cron scheduler) will catch it.
  if (!MONGO_URI) throw new Error("Missing MONGO_URI in env");
  if (!SHIPROCKET_TOKEN) throw new Error("Missing SHIPROCKET_TOKEN in env");

  console.log("🔧 ENV CHECK:", {
    MONGO_URI: "✅ set",
    SHIPROCKET_TOKEN: "✅ set",
  });

  await mongoose.connect(MONGO_URI);
  console.log("✅ Mongo connected:", {
    db: mongoose.connection?.name,
    host: mongoose.connection?.host,
  });

  try {
    // ✅ candidates: confirmed + shiprocket + awb + not final
    // (we will still only UPDATE ofd/delivered)
    const query = {
      isConfirmed: true,
      "shipment.provider": "shiprocket",
      "shipment.shiprocket.awb": { $exists: true, $ne: "" },
      fulfillmentStatus: { $nin: ["delivered", "cancelled", "rto"] },
    };

    const orders = await Order.find(query).select(
      "_id orderNumber orderType isConfirmed fulfillmentStatus shipment trackingDetails"
    );

    console.log(`📦 Shiprocket Sync: found ${orders.length} candidate orders`);

    let updated = 0;
    let skipped = 0;
    let rawPrinted = 0;

    for (const order of orders) {
      const awb = order?.shipment?.shiprocket?.awb;
      if (!awb) continue;

      try {
        const payload = await trackByAwb(awb);

        if (DEBUG_PRINT_RAW_PAYLOAD && rawPrinted < RAW_PAYLOAD_PRINT_LIMIT) {
          console.log(`📡 RAW PAYLOAD for ${order.orderNumber} (awb=${awb}):`);
          console.log(safeJson(payload));
          rawPrinted++;
        }

        const srStatusRaw = extractShiprocketStatus(payload);
        const mapped = mapShiprocketToLocal(srStatusRaw);
        const nextStatus = String(mapped || "").trim();

        // ✅ HARD GATE: Only OFD / Delivered updates allowed from this cron
        if (!ALLOWED_LOCAL_UPDATES.has(nextStatus)) {
          skipped++;
          continue;
        }

        const currentFulfillment = String(
          order.fulfillmentStatus || "processing"
        );
        const currentShipmentStatus = String(
          order?.shipment?.status || "processing"
        );

        // ✅ No downgrades (safety)
        if (!shouldUpdateStatus(currentFulfillment, nextStatus)) {
          console.log(
            `⏭️ SKIP DOWNGRADE ${order.orderNumber}: ${currentFulfillment} -> ${nextStatus} (sr="${srStatusRaw}")`
          );
          skipped++;
          continue;
        }

        // no change
        if (
          currentFulfillment === nextStatus &&
          currentShipmentStatus === nextStatus
        ) {
          continue;
        }

        const $set = {
          "shipment.status": nextStatus,
          fulfillmentStatus: nextStatus, // ✅ we DO update fulfillment for these 2 statuses
        };

        // optional courier/tracking url
        const td = payload?.tracking_data || {};
        if (td?.courier_name)
          $set["shipment.shiprocket.courierName"] = td.courier_name;
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
          if (!order?.trackingDetails?.deliveredAt)
            $set["trackingDetails.deliveredAt"] = now;
        }

        await Order.updateOne({ _id: order._id }, { $set });

        updated++;

        console.log(
          `✅ ${order.orderNumber} : fulfillment(${currentFulfillment}) -> (${nextStatus}) | shipment(${currentShipmentStatus}) -> (${nextStatus}) | sr="${srStatusRaw}"`
        );
      } catch (err) {
        const msg = err?.response?.data
          ? safeJson(err.response.data)
          : err?.message || String(err);
        console.error(`❌ ${order.orderNumber} (awb=${awb}) failed:\n${msg}`);
      }
    }

    console.log(
      `✅ Shiprocket Sync done. Updated: ${updated}/${orders.length} | Skipped: ${skipped}`
    );
  } finally {
    // ✅ always disconnect (but don't crash app)
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
 *
 * IMPORTANT: Do NOT process.exit() in imported mode.
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
      // Exit only in CLI mode
      process.exit(1);
    });
}
