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

if (!MONGO_URI) {
  console.error("❌ Missing MONGO_URI in env");
  process.exit(1);
}
if (!SHIPROCKET_TOKEN) {
  console.error("❌ Missing SHIPROCKET_TOKEN in env");
  process.exit(1);
}

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
  console.log("🔧 ENV CHECK:", {
    MONGO_URI: MONGO_URI ? "✅ set" : "❌ missing",
    SHIPROCKET_TOKEN: SHIPROCKET_TOKEN ? "✅ set" : "❌ missing",
  });

  await mongoose.connect(MONGO_URI);
  console.log("✅ Mongo connected:", {
    db: mongoose.connection?.name,
    host: mongoose.connection?.host,
  });

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
      const mapped = mapShiprocketToLocal(srStatusRaw); // could be shipped/picked/etc.
      const nextStatus = String(mapped || "").trim();

      // ✅ HARD GATE: Only OFD / Delivered updates allowed from this cron
      if (!ALLOWED_LOCAL_UPDATES.has(nextStatus)) {
        // example: "shipped" will be ignored
        skipped++;
        continue;
      }

      const currentFulfillment = String(order.fulfillmentStatus || "processing");
      const currentShipmentStatus = String(order?.shipment?.status || "processing");

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
      const msg = err?.response?.data ? safeJson(err.response.data) : err.message;
      console.error(`❌ ${order.orderNumber} (awb=${awb}) failed:\n${msg}`);
    }
  }

  console.log(
    `✅ Shiprocket Sync done. Updated: ${updated}/${orders.length} | Skipped: ${skipped}`
  );

  await mongoose.disconnect();
  console.log("✅ Mongo disconnected");
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
