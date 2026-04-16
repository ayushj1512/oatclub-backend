import "dotenv/config";
import dns from "node:dns";
import mongoose from "mongoose";
import Order from "../Orders/Orders.js";

// same DNS fix as server.js
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI missing in .env");
  process.exit(1);
}

const BATCH_SIZE = 200;
const DRY_RUN = process.argv.includes("--dry");

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const computeIsPackable = (order) => {
  if (!order?.isConfirmed) return false;

  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) return false;

  return items.every(
    (item) => toNum(item?.fulfillment?.toProduceQty, 0) === 0
  );
};

async function connectDB() {
  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });
  console.log("✅ MongoDB connected");
}

async function main() {
  await connectDB();

  const baseFilter = {
    fulfillmentStatus: "processing",
  };

  const total = await Order.countDocuments(baseFilter);

  console.log(`📦 Processing orders found: ${total}`);
  console.log(`🧪 Dry run: ${DRY_RUN ? "YES" : "NO"}`);

  let lastId = null;
  let scanned = 0;
  let changed = 0;
  let unchanged = 0;
  let confirmedPackable = 0;
  let confirmedUnpackable = 0;
  let unconfirmed = 0;

  while (true) {
    const query = {
      ...baseFilter,
      ...(lastId ? { _id: { $gt: lastId } } : {}),
    };

    const orders = await Order.find(query)
      .select("_id orderNumber isConfirmed isPackable items.fulfillment.toProduceQty")
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .lean();

    if (!orders.length) break;

    const bulkOps = [];

    for (const order of orders) {
      scanned += 1;

      const nextIsPackable = computeIsPackable(order);

      if (!order?.isConfirmed) {
        unconfirmed += 1;
      } else if (nextIsPackable) {
        confirmedPackable += 1;
      } else {
        confirmedUnpackable += 1;
      }

      if (Boolean(order?.isPackable) !== nextIsPackable) {
        changed += 1;

        bulkOps.push({
          updateOne: {
            filter: { _id: order._id },
            update: {
              $set: { isPackable: nextIsPackable },
            },
          },
        });

        console.log(`✏️ ${order.orderNumber} -> isPackable=${nextIsPackable}`);
      } else {
        unchanged += 1;
      }
    }

    if (!DRY_RUN && bulkOps.length) {
      const result = await Order.bulkWrite(bulkOps, { ordered: false });
      console.log(
        `✅ Batch updated: ${result.modifiedCount || 0}/${bulkOps.length}`
      );
    }

    lastId = orders[orders.length - 1]._id;

    console.log(
      `📍 Progress: ${scanned}/${total} | changed=${changed} | unchanged=${unchanged}`
    );
  }

  console.log("\n✅ Done");
  console.log({
    total,
    scanned,
    changed,
    unchanged,
    confirmedPackable,
    confirmedUnpackable,
    unconfirmed,
    dryRun: DRY_RUN,
  });

  await mongoose.disconnect();
  console.log("🔌 MongoDB disconnected");
}

main().catch(async (err) => {
  console.error("❌ Script failed:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});