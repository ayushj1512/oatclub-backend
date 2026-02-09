import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import fs from "fs";
import { Parser } from "json2csv";

dotenv.config();

const URI = process.env.MONGO_URI;
if (!URI) {
  console.error("❌ MONGODB_URI missing in .env");
  process.exit(1);
}

const client = new MongoClient(URI);

// Jan 2026 (UTC)
const START = new Date("2026-01-01T00:00:00.000Z");
const END = new Date("2026-02-01T00:00:00.000Z");

const ddmmyy = (d) => {
  const dt = d instanceof Date ? d : d ? new Date(d) : null;
  if (!dt || Number.isNaN(dt.getTime())) return "";
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(dt.getUTCFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
};

async function run() {
  try {
    await client.connect();
    const db = client.db(); // DB name from URI
    const orders = db.collection("orders");

    const pipeline = [
      // ✅ only delivered orders
      { $match: { fulfillmentStatus: "delivered" } },

      // ✅ pick a "delivered date" with fallbacks (so blanks don't kill data)
      {
        $addFields: {
          deliveredAtResolved: {
            $ifNull: [
              "$shipment.deliveredAt",
              {
                $ifNull: [
                  "$trackingDetails.deliveredAt",
                  {
                    $ifNull: ["$trackingDetails.shippedAt", "$updatedAt"]
                  }
                ]
              }
            ]
          },

          // ✅ payable is order finalPayable
          payable: { $toDouble: { $ifNull: ["$finalPayable", 0] } },

          // courier + awb fallbacks
          courierName: {
            $ifNull: [
              "$shipment.shiprocket.courierName",
              {
                $ifNull: [
                  "$shipment.xpressbees.courierName",
                  { $ifNull: ["$trackingDetails.courierName", ""] }
                ]
              }
            ]
          },
          awb: {
            $ifNull: [
              "$shipment.shiprocket.awb",
              {
                $ifNull: [
                  "$shipment.xpressbees.awb",
                  { $ifNull: ["$trackingDetails.trackingId", ""] }
                ]
              }
            ]
          }
        }
      },

      // ✅ Jan 2026 filter on resolved date
      {
        $match: {
          deliveredAtResolved: { $gte: START, $lt: END }
        }
      },

      // ✅ one row per item
      { $unwind: "$items" },

      // compute taxable & tax @5% from payable (finalPayable)
      {
        $addFields: {
          taxableValue: { $divide: ["$payable", 1.05] },
          taxAmount: { $subtract: ["$payable", { $divide: ["$payable", 1.05] }] },

          productName: { $ifNull: ["$items.productSnapshot.title", ""] },
          hsnCode: { $ifNull: ["$items.productSnapshot.hsnCode", ""] },
          qty: { $toInt: { $ifNull: ["$items.quantity", 0] } }
        }
      },

      {
        $project: {
          _id: 0,
          orderNumber: 1,
          deliveredAt: "$deliveredAtResolved",
          courierName: 1,
          awb: 1,
          productName: 1,
          hsnCode: 1,
          qty: 1,
          payable: { $round: ["$payable", 2] },
          taxableValue: { $round: ["$taxableValue", 2] },
          taxAmount: { $round: ["$taxAmount", 2] }
        }
      },

      { $sort: { deliveredAt: 1, orderNumber: 1 } }
    ];

    const rows = await orders.aggregate(pipeline, { allowDiskUse: true }).toArray();

    if (!rows.length) {
      console.log("⚠️ No delivered orders found for Jan 2026.");
      console.log("👉 Check: fulfillmentStatus must be 'delivered' and deliveredAt present (or fallback updatedAt).");
      return;
    }

    // ✅ format deliveredAt as dd-mm-yy in JS (CSV-friendly)
    const data = rows.map((r) => ({
      ...r,
      deliveredAt: ddmmyy(r.deliveredAt),
    }));

    const fields = [
      "orderNumber",
      "deliveredAt",
      "courierName",
      "awb",
      "productName",
      "hsnCode",
      "qty",
      "payable",
      "taxableValue",
      "taxAmount",
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(data);

    fs.writeFileSync("delivered_orders_jan_2026.csv", csv, "utf8");

    console.log("✅ CSV generated: delivered_orders_jan_2026.csv");
    console.log("📦 Rows:", data.length);
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await client.close();
  }
}

run();
