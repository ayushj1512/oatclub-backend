import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import dotenv from "dotenv";

// ✅ tumhare project ke hisaab se path
import Order from "../Orders/Orders.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

// -------- helpers ----------
function parseDDMMYYYY_HHMM(str) {
  // "03-03-2026 13:25"
  if (!str) return null;
  const s = String(str).trim().replace(/^"|"$/g, "");
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;

  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const HH = Number(m[4]);
  const MM = Number(m[5]);

  // IST assumed (+05:30)
  const iso = `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(
    2,
    "0"
  )}T${String(HH).padStart(2, "0")}:${String(MM).padStart(2, "0")}:00+05:30`;

  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function safeSplitCSVLine(line) {
  // basic CSV split (works if no commas inside fields)
  // if your CSV has commas inside quoted fields, tell me and I’ll upgrade parser
  return line.split(",").map((x) => x.trim());
}

function readCSVWithHeaders(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return { rows: [], header: [] };

  const header = safeSplitCSVLine(lines[0]).map((h) =>
    h.replace(/^"|"$/g, "").trim()
  );

  const orderIdIdx = header.findIndex((h) => h.toLowerCase() === "order id");
  const deliveredIdx = header.findIndex(
    (h) => h.toLowerCase() === "order delivered date"
  );

  if (orderIdIdx === -1 || deliveredIdx === -1) {
    throw new Error(
      `CSV headers not found. Need columns: "Order ID" and "Order Delivered Date". Found: ${header.join(
        " | "
      )}`
    );
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = safeSplitCSVLine(lines[i]);
    const orderId = (cols[orderIdIdx] ?? "").replace(/^"|"$/g, "").trim();
    const deliveredStr = (cols[deliveredIdx] ?? "")
      .replace(/^"|"$/g, "")
      .trim();

    if (!orderId) continue;
    rows.push({ orderId, deliveredStr });
  }

  return { rows, header };
}

// -------- main ----------
async function run() {
  const csvArg = process.argv[2];
  const csvPath = csvArg
    ? path.resolve(csvArg)
    : path.resolve("scripts", "delivered.csv"); // ✅ default

  if (!MONGO_URI) throw new Error("MONGO_URI missing in .env");
  if (!fs.existsSync(csvPath)) throw new Error(`CSV not found: ${csvPath}`);

  const csvText = fs.readFileSync(csvPath, "utf8");
  const { rows } = readCSVWithHeaders(csvText);

  // ✅ de-dupe: keep latest delivered date per Order ID
  const map = new Map();
  for (const r of rows) {
    const dt = parseDDMMYYYY_HHMM(r.deliveredStr);
    if (!dt) continue;

    const key = String(r.orderId).trim();
    const prev = map.get(key);
    if (!prev || dt > prev) map.set(key, dt);
  }

  console.log("CSV rows:", rows.length);
  console.log("Unique order IDs with valid delivered date:", map.size);

  await mongoose.connect(MONGO_URI);
  console.log("MongoDB connected");

  let updated = 0;
  let skipped = 0;
  let badId = 0;

  const now = new Date();

  for (const [orderId, deliveredAt] of map.entries()) {
    // ✅ only handle MIRAY-XXXXXX (since your CSV "Order ID" is this)
    const isOrderNumber = /^MIRAY-\d{6}$/i.test(orderId);
    if (!isOrderNumber) {
      badId++;
      console.log("IGNORE (not an orderNumber):", orderId);
      continue;
    }

    const exists = await Order.findOne(
      { orderNumber: orderId },
      { _id: 1, paymentMethod: 1, paymentStatus: 1 }
    ).lean();

    if (!exists) {
      skipped++;
      console.log("SKIP (not found in DB):", orderId);
      continue;
    }

    // ✅ IMPORTANT: use updateOne (no save hooks)
    await Order.updateOne(
      { orderNumber: orderId },
      {
        $set: {
          fulfillmentStatus: "delivered",
          "shipment.status": "delivered",
          "shipment.deliveredAt": deliveredAt,

          "trackingDetails.deliveredAt": deliveredAt,

          // timestamps safe
          updatedAt: now,
        },
      }
    );

    updated++;
    console.log("UPDATED:", orderId, "deliveredAt:", deliveredAt.toISOString());
  }

  console.log("--------------------------------------------------");
  console.log("DONE");
  console.log("Updated:", updated);
  console.log("Skipped (not found):", skipped);
  console.log("Ignored (not orderNumber):", badId);

  process.exit(0);
}

run().catch((e) => {
  console.error("Repair failed:", e);
  process.exit(1);
});