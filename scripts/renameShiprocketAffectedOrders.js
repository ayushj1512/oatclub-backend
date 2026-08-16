import "dotenv/config";
import dns from "dns";
import mongoose from "mongoose";
import Order from "../Orders/Orders.js";

/* ============================================================
   CONFIG
============================================================ */

const DRY_RUN = false;

const ORDER_NUMBERS = [
  "000041",
  "000084",
  "000088",
  "000098",
  "000145",
  "000148",
  "000154",
  "000174",
  "000178",
  "000184",
  "000191",
  "000234",
  "000242",
  "000244",
  "000249",
  "000251",
  "000252",
  "000254",
  "000255",
  "000259",
  "000260",
  "000262",
  "000266",
  "000267",
  "000268",
  "000281",
  "000286",
  "000289",
];

/* ============================================================
   HELPERS
============================================================ */

const removeOneLeadingZero = (value) => {
  const orderNumber = String(value || "").trim();

  if (!/^0\d{5}$/.test(orderNumber)) {
    throw new Error(`Invalid 6-digit order number: ${orderNumber}`);
  }

  return orderNumber.slice(1);
};

/* ============================================================
   MAIN
============================================================ */

async function main() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI missing in .env");
    }

    dns.setServers(["1.1.1.1", "1.0.0.1"]);

    console.log("🔌 Connecting MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);

    console.log("✅ MongoDB connected");
    console.log(`🧪 DRY_RUN: ${DRY_RUN ? "TRUE" : "FALSE"}`);
    console.log(`📦 Requested orders: ${ORDER_NUMBERS.length}\n`);

    const mappings = ORDER_NUMBERS.map((oldNumber) => ({
      oldNumber,
      newNumber: removeOneLeadingZero(oldNumber),
    }));

    /* --------------------------------------------------------
       1. Check duplicate input/new numbers
    -------------------------------------------------------- */

    const newNumbers = mappings.map((x) => x.newNumber);

    if (new Set(newNumbers).size !== newNumbers.length) {
      throw new Error("Duplicate target order numbers detected in script");
    }

    /* --------------------------------------------------------
       2. Fetch requested orders
    -------------------------------------------------------- */

    const orders = await Order.find({
      orderNumber: { $in: ORDER_NUMBERS },
    })
      .select(
        "_id orderNumber orderType paymentMethod fulfillmentStatus isConfirmed shipment",
      )
      .lean();

    const foundMap = new Map(
      orders.map((order) => [order.orderNumber, order]),
    );

    /* --------------------------------------------------------
       3. Check missing orders
    -------------------------------------------------------- */

    const missing = mappings.filter(
      ({ oldNumber }) => !foundMap.has(oldNumber),
    );

    if (missing.length) {
      console.log("❌ Missing orders:");

      for (const item of missing) {
        console.log(`   ${item.oldNumber}`);
      }

      throw new Error(
        `Aborted: ${missing.length} requested order(s) not found`,
      );
    }

    /* --------------------------------------------------------
       4. Collision check
    -------------------------------------------------------- */

    const collisions = await Order.find({
      orderNumber: { $in: newNumbers },
    })
      .select("_id orderNumber")
      .lean();

    if (collisions.length) {
      console.log("\n🚨 TARGET COLLISIONS FOUND:");

      for (const order of collisions) {
        console.log(
          `   ${order.orderNumber} already belongs to ${order._id}`,
        );
      }

      throw new Error(
        "Aborted: target order number already exists",
      );
    }

    /* --------------------------------------------------------
       5. Safety preview
    -------------------------------------------------------- */

    console.log("\n============================================");
    console.log("ORDER NUMBER MIGRATION PREVIEW");
    console.log("============================================");

    for (const { oldNumber, newNumber } of mappings) {
      const order = foundMap.get(oldNumber);

      console.log(
        `${oldNumber} → ${newNumber}` +
        ` | ${order.paymentMethod}` +
        ` | ${order.fulfillmentStatus}` +
        ` | confirmed=${order.isConfirmed}` +
        ` | awb=${order?.shipment?.awb || "-"}`,
      );
    }

    console.log("============================================\n");

    /* --------------------------------------------------------
       6. DRY RUN STOP
    -------------------------------------------------------- */

    if (DRY_RUN) {
      console.log("🧪 DRY RUN COMPLETE");
      console.log("✅ No database changes made.");
      console.log(
        "👉 Verify above list, then change DRY_RUN = false",
      );
      return;
    }

    /* --------------------------------------------------------
       7. Actual migration
    -------------------------------------------------------- */

    console.log("⚠️ LIVE MODE — updating order numbers...\n");

    let updated = 0;

    for (const { oldNumber, newNumber } of mappings) {
      const result = await Order.updateOne(
        {
          orderNumber: oldNumber,
        },
        {
          $set: {
            orderNumber: newNumber,
          },
        },
      );

      if (result.modifiedCount !== 1) {
        throw new Error(
          `Failed updating ${oldNumber} → ${newNumber}`,
        );
      }

      updated += 1;

      console.log(`✅ ${oldNumber} → ${newNumber}`);
    }

    /* --------------------------------------------------------
       8. Final verification
    -------------------------------------------------------- */

    const verified = await Order.countDocuments({
      orderNumber: { $in: newNumbers },
    });

    if (verified !== mappings.length) {
      throw new Error(
        `Verification failed: expected ${mappings.length}, found ${verified}`,
      );
    }

    console.log("\n============================================");
    console.log("✅ MIGRATION COMPLETE");
    console.log(`Updated: ${updated}/${mappings.length}`);
    console.log("============================================");
  } catch (error) {
    console.error("\n❌ SCRIPT FAILED");
    console.error(error?.message || error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("\n🔌 MongoDB disconnected");
  }
}

main();
