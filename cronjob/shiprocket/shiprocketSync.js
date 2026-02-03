import "dotenv/config";
import mongoose from "mongoose";
import axios from "axios";
import Order from "../../Orders/Orders.js"; // ✅ your path
import {
  mapShiprocketToLocal,
  extractShiprocketStatus,
  shouldUpdateStatus, // ✅ NEW: prevents downgrades
} from "./shiprocketStatusMap.js";

const { MONGO_URI, SHIPROCKET_TOKEN } = process.env;

// =============================
// CONFIG FLAGS (debug behavior)
// =============================

// If TRUE, print raw shiprocket payload for first few orders
const DEBUG_PRINT_RAW_PAYLOAD = false;

// If TRUE, do NOT change fulfillmentStatus for parent orders
// (useful if you don't want parents to ever move shipping stages)
const DONT_TOUCH_FULFILLMENT_FOR_PARENTS = false;

// limit raw payload printing (avoid huge logs)
const RAW_PAYLOAD_PRINT_LIMIT = 2;

if (!MONGO_URI) {
  console.error("❌ Missing MONGO_URI in env");
  process.exit(1);
}
if (!SHIPROCKET_TOKEN) {
  console.error("❌ Missing SHIPROCKET_TOKEN in env");
  process.exit(1);
}

// =============================
// Helpers
// =============================
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

function isFinalStatus(status) {
  return ["delivered", "cancelled", "rto"].includes(String(status || ""));
}

function safeJson(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

// For shippedAt logic: treat these as "movement started"
function isShippedLike(status) {
  return ["shipped", "out_for_delivery", "delivered", "rto"].includes(
    String(status || "")
  );
}

// =============================
// Debug Counts
// =============================
async function debugCounts() {
  const total = await Order.countDocuments();

  const hasAwb = await Order.countDocuments({
    "shipment.shiprocket.awb": { $exists: true, $ne: "" },
  });

  const shiprocketProvider = await Order.countDocuments({
    "shipment.provider": "shiprocket",
  });

  const shipmentType = await Order.countDocuments({ orderType: "shipment" });

  const confirmed = await Order.countDocuments({ isConfirmed: true });

  const notFinal = await Order.countDocuments({
    fulfillmentStatus: { $nin: ["delivered", "cancelled", "rto"] },
  });

  // strict candidates (shipment split orders only)
  const strictCandidates = await Order.countDocuments({
    orderType: "shipment",
    isConfirmed: true,
    "shipment.provider": "shiprocket",
    "shipment.shiprocket.awb": { $exists: true, $ne: "" },
    fulfillmentStatus: { $nin: ["delivered", "cancelled", "rto"] },
  });

  // relaxed candidates (without orderType)
  const relaxedCandidates = await Order.countDocuments({
    isConfirmed: true,
    "shipment.provider": "shiprocket",
    "shipment.shiprocket.awb": { $exists: true, $ne: "" },
    fulfillmentStatus: { $nin: ["delivered", "cancelled", "rto"] },
  });

  console.log("🧪 DEBUG COUNTS:", {
    total,
    hasAwb,
    shiprocketProvider,
    shipmentType,
    confirmed,
    notFinal,
    strictCandidates,
    relaxedCandidates,
  });
}

async function printSampleAwbOrders() {
  const sample = await Order.find({
    "shipment.shiprocket.awb": { $exists: true, $ne: "" },
  })
    .limit(5)
    .select(
      "orderNumber orderType isConfirmed fulfillmentStatus shipment.provider shipment.shiprocket.awb shipment.status"
    )
    .lean();

  console.log("🧾 SAMPLE ORDERS WITH AWB (max 5):");
  console.log(safeJson(sample));
}

// =============================
// Main runner
// =============================
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

  // ----- DEBUG BLOCKS -----
  await debugCounts();
  await printSampleAwbOrders();

  // ----- Query 1: strict (shipment split orders only) -----
  let query = {
    orderType: "shipment",
    isConfirmed: true,
    "shipment.provider": "shiprocket",
    "shipment.shiprocket.awb": { $exists: true, $ne: "" },
    fulfillmentStatus: { $nin: ["delivered", "cancelled", "rto"] },
  };

  let orders = await Order.find(query).select(
    "_id orderNumber orderType isConfirmed fulfillmentStatus shipment trackingDetails"
  );

  // ----- Fallback: relaxed query if strict yields none -----
  if (orders.length === 0) {
    console.log(
      "⚠️ Strict query returned 0 orders. Falling back to relaxed query (ignoring orderType)."
    );

    query = {
      isConfirmed: true,
      "shipment.provider": "shiprocket",
      "shipment.shiprocket.awb": { $exists: true, $ne: "" },
      fulfillmentStatus: { $nin: ["delivered", "cancelled", "rto"] },
    };

    orders = await Order.find(query).select(
      "_id orderNumber orderType isConfirmed fulfillmentStatus shipment trackingDetails"
    );
  }

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

      // ✅ Now we extract numeric shipment_status (if present),
      // and map via the table-based mapper
      const srStatusRaw = extractShiprocketStatus(payload);
      const nextStatus = mapShiprocketToLocal(srStatusRaw);

      const currentFulfillment = String(order.fulfillmentStatus || "processing");
      const currentShipmentStatus = String(order?.shipment?.status || "processing");

      // ✅ Skip if mapping gives empty or unknown
      if (!nextStatus) {
        console.log(
          `⏭️ SKIP ${order.orderNumber}: nextStatus empty (sr="${srStatusRaw}")`
        );
        skipped++;
        continue;
      }

      // ✅ No downgrades (prevents shipped -> processing)
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

      // build update
      const $set = {
        "shipment.status": nextStatus,
      };

      // parent safety behavior
      const isParent = order?.orderType === "parent";
      if (!(DONT_TOUCH_FULFILLMENT_FOR_PARENTS && isParent)) {
        $set.fulfillmentStatus = nextStatus;
      }

      // fill courier/tracking url if present in payload
      const td = payload?.tracking_data || {};
      if (td?.courier_name)
        $set["shipment.shiprocket.courierName"] = td.courier_name;
      if (td?.track_url)
        $set["shipment.shiprocket.trackingUrl"] = td.track_url;

      // timestamps (more robust)
      const now = new Date();

      // If any shipped-like status comes and shippedAt missing, set it
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
        `✅ ${order.orderNumber} [${order.orderType}] : fulfillment(${currentFulfillment}) -> (${nextStatus}) | shipment(${currentShipmentStatus}) -> (${nextStatus}) | sr="${srStatusRaw}"`
      );

      if (isFinalStatus(nextStatus)) {
        console.log(`🏁 ${order.orderNumber} reached final status: ${nextStatus}`);
      }
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

// =============================
// Execute
// =============================
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
