import mongoose from "mongoose";
import dotenv from "dotenv";
import Order from "../Orders/Orders.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const BASE_URL = "http://localhost:5000";

const s = (v) => String(v ?? "").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hitWebhook(orderNumber) {
  const url = `${BASE_URL}/api/inventory-reservations/webhook/reserve-order/${orderNumber}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.message || "Webhook failed");
  }

  return data;
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("✅ Mongo connected");

  const orders = await Order.find({
    isConfirmed: true,
    fulfillmentStatus: "processing",
    orderType: { $ne: "parent" },
  }).sort({ createdAt: 1 });

  console.log(`\n🚀 Processing ${orders.length} orders\n`);

  let ok = 0;
  let fail = 0;

  for (const order of orders) {
    const orderNumber = s(order.orderNumber);
    if (!orderNumber) continue;

    try {
      console.log(`🔧 ${orderNumber}`);

      // 🔥 STEP 1: reset fulfillment (VERY IMPORTANT)
      let changed = false;

      for (const item of order.items || []) {
        const qty = Number(item.quantity || 0);
        const shipped = Number(item?.fulfillment?.shippedQty || 0);

        const newAllocated = 0;
        const newToProduce = Math.max(0, qty - shipped);

        if (!item.fulfillment) item.fulfillment = {};

        if (
          item.fulfillment.allocatedQty !== newAllocated ||
          item.fulfillment.toProduceQty !== newToProduce
        ) {
          item.fulfillment.allocatedQty = newAllocated;
          item.fulfillment.toProduceQty = newToProduce;
          changed = true;
        }
      }

      if (changed) {
        await order.save();
        console.log(`   ↺ Reset done`);
      }

      // 🔥 STEP 2: webhook hit
      const res = await hitWebhook(orderNumber);

      console.log(`   ✅ reserved`, res?.summary || {});
      ok++;
    } catch (e) {
      console.error(`   ❌ ${orderNumber}`, e.message);
      fail++;
    }

    await sleep(150); // safe gap
  }

  console.log("\n====================");
  console.log(`Success: ${ok}`);
  console.log(`Failed : ${fail}`);
  console.log("====================\n");
}

main()
  .catch(console.error)
  .finally(() => mongoose.disconnect());