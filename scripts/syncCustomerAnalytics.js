// --------------------------------------------------
// Customer Analytics Backfill Script
// --------------------------------------------------

// ✅ MUST BE FIRST
import "dotenv/config";

import dns from "dns";
import mongoose from "mongoose";

import Customer from "../Customer/Customer.js";
import Order from "../Orders/Orders.js";
import { recalculateCustomerAnalytics } from "../Customer/customerAnalytics.service.js";

// --------------------------------------------------
// DNS CONFIG (same style as server)
// --------------------------------------------------
dns.setServers(["1.1.1.1", "1.0.0.1"]);

// --------------------------------------------------
// FLAGS
// --------------------------------------------------
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : 0;

// --------------------------------------------------
// ENV
// --------------------------------------------------
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI missing");
  process.exit(1);
}

// --------------------------------------------------
// HELPERS
// --------------------------------------------------
const num = (n) => Number(n || 0);

const previewAnalytics = async (customerId) => {
  const orders = await Order.find({ customerId })
    .select("finalPayable totalAmount fulfillmentStatus paymentStatus")
    .lean();

  const totalOrders = orders.length;

  const totalSpend = orders.reduce(
    (sum, o) => sum + num(o.finalPayable ?? o.totalAmount),
    0
  );

  const count = (status) =>
    orders.filter((o) => o.fulfillmentStatus === status).length;

  return {
    totalOrders,
    totalSpend,
    delivered: count("delivered"),
    cancelled: count("cancelled"),
    returned: count("returned"),
    rto: count("rto"),
  };
};

// --------------------------------------------------
// MAIN
// --------------------------------------------------
const run = async () => {
  try {
    console.log("🔌 Connecting DB...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected");

    console.log(DRY_RUN ? "🧪 DRY RUN MODE" : "🚀 LIVE MODE");

    let query = Customer.find().select(
      "_id customerId name email phone analytics"
    );

    if (LIMIT > 0) query = query.limit(LIMIT);

    const customers = await query.lean();

    console.log(`👥 Customers: ${customers.length}`);

    let synced = 0;
    let skipped = 0;
    let failed = 0;

    for (const c of customers) {
      try {
        const preview = await previewAnalytics(c._id);

        if (!preview.totalOrders) {
          skipped++;
          continue;
        }

        console.log("--------------------------------------------------");
        console.log(
          `${DRY_RUN ? "🧪 WOULD SYNC" : "✅ SYNC"} ${
            c.customerId || c._id
          } | ${c.name || c.email || c.phone || "Unnamed"}`
        );

        console.table({
          orders: preview.totalOrders,
          spend: preview.totalSpend,
          delivered: preview.delivered,
          cancelled: preview.cancelled,
          returned: preview.returned,
          rto: preview.rto,
        });

        if (!DRY_RUN) {
          await recalculateCustomerAnalytics(c._id);
        }

        synced++;
      } catch (err) {
        failed++;
        console.error("❌ Failed:", c._id, err.message);
      }
    }

    console.log("==================================================");
    console.log("✅ DONE");

    console.table({
      mode: DRY_RUN ? "dry-run" : "live",
      total: customers.length,
      synced,
      skipped,
      failed,
    });
  } catch (err) {
    console.error("❌ Script failed:", err);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected");
  }
};

run();