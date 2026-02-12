/**
 * scripts/size-correct/fix-order-sku-size.js
 *
 * Fix Order items SKU + Size using Excel file (row-per-item export).
 *
 * DRY RUN (default):
 *   node scripts/size-correct/fix-order-sku-size.js
 *
 * COMMIT:
 *   node scripts/size-correct/fix-order-sku-size.js --commit
 *
 * Optional:
 *   --file="scripts/size-correct/orders-2026-02-10-11-00-16 1.xlsx"
 *   --limit=50
 */

import "dotenv/config";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import xlsx from "xlsx";

// ✅ IMPORTANT: make sure this path matches your project
import Order from "../../Orders/Orders.js"; // <-- adjust if your Order model lives elsewhere

const MONGO_URI = (process.env.MONGO_URI || "").trim();

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
};

const hasFlag = (f) => process.argv.includes(f);

const toStr = (v) => (v == null ? "" : String(v)).trim();
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function upsertSizeAttr(attributes = [], sizeValue) {
  const attrs = Array.isArray(attributes) ? [...attributes] : [];
  const idx = attrs.findIndex(
    (a) => ["size", "sizes"].includes(String(a?.key || "").toLowerCase())
  );

  if (idx >= 0) {
    attrs[idx] = { ...attrs[idx], key: attrs[idx].key || "size", value: String(sizeValue) };
  } else {
    attrs.push({ key: "size", value: String(sizeValue) });
  }

  return attrs;
}

function pickItemByIndexOrFallback(order, itemIndex0, productCode, title) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const byIndex = items[itemIndex0];

  // Prefer index if it matches roughly
  if (byIndex) {
    const codeOk =
      !productCode ||
      String(byIndex?.productSnapshot?.productCode || "") === String(productCode);

    const titleOk =
      !title ||
      toStr(byIndex?.productSnapshot?.title).toLowerCase() === toStr(title).toLowerCase();

    // if export index is correct usually this will pass
    if (codeOk || titleOk) return { item: byIndex, foundBy: "index" };
  }

  // Fallback: try productCode match
  if (productCode) {
    const found = items.find(
      (it) => String(it?.productSnapshot?.productCode || "") === String(productCode)
    );
    if (found) return { item: found, foundBy: "productCode" };
  }

  // Fallback: try title match
  if (title) {
    const found = items.find(
      (it) => toStr(it?.productSnapshot?.title).toLowerCase() === toStr(title).toLowerCase()
    );
    if (found) return { item: found, foundBy: "title" };
  }

  return { item: null, foundBy: null };
}

async function main() {
  if (!MONGO_URI) {
    console.error("❌ MONGO_URI missing in .env");
    process.exit(1);
  }

  const DRY_RUN = !hasFlag("--commit");
  const LIMIT = arg("limit") ? Number(arg("limit")) : 0;

  const filePath =
    arg("file") ||
    path.join("scripts", "size-correct", "orders-2026-02-10-11-00-16 1.xlsx");

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Excel file not found: ${filePath}`);
    process.exit(1);
  }

  console.log("======================================");
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN" : "COMMIT"}`);
  console.log(`File: ${filePath}`);
  console.log("======================================");

  await mongoose.connect(MONGO_URI, { autoIndex: false });
  console.log("✅ MongoDB connected");

  // Read workbook
  const wb = xlsx.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  const rows = xlsx.utils.sheet_to_json(ws, { defval: "" });

  // Expect headers:
  // Order #, Item #, Item SKU, Item Size, Product Code, Item Title
  const normalized = rows
    .map((r) => ({
      orderNumber: toStr(r["Order #"]),
      itemNo1: toNum(r["Item #"]), // 1-based
      itemIndex0: Math.max(0, toNum(r["Item #"]) - 1),
      itemSku: toStr(r["Item SKU"]),
      itemSize: toStr(r["Item Size"]),
      productCode: toStr(r["Product Code"]),
      itemTitle: toStr(r["Item Title"]),
    }))
    .filter((r) => r.orderNumber && r.itemSku && r.itemSize);

  // Group by orderNumber
  const byOrder = new Map();
  for (const r of normalized) {
    if (!byOrder.has(r.orderNumber)) byOrder.set(r.orderNumber, []);
    byOrder.get(r.orderNumber).push(r);
  }

  const orderNumbers = Array.from(byOrder.keys());
  const workList = LIMIT ? orderNumbers.slice(0, LIMIT) : orderNumbers;

  let stats = {
    ordersSeen: 0,
    ordersFound: 0,
    ordersUpdated: 0,
    itemsPlanned: 0,
    itemsMatched: 0,
    itemsChanged: 0,
    itemsSkippedNoMatch: 0,
  };

  for (const orderNumber of workList) {
    stats.ordersSeen++;

    const order = await Order.findOne({ orderNumber });
    if (!order) {
      console.log(`❌ Order not found: ${orderNumber}`);
      continue;
    }
    stats.ordersFound++;

    const fixes = byOrder.get(orderNumber) || [];
    stats.itemsPlanned += fixes.length;

    let changedThisOrder = false;

    for (const f of fixes) {
      const { item, foundBy } = pickItemByIndexOrFallback(
        order,
        f.itemIndex0,
        f.productCode,
        f.itemTitle
      );

      if (!item) {
        stats.itemsSkippedNoMatch++;
        console.log(
          `⚠️  No item match: ${orderNumber} | Item# ${f.itemNo1} | code=${f.productCode} | title=${f.itemTitle}`
        );
        continue;
      }

      stats.itemsMatched++;

      const before = {
        selectedSize: toStr(item.selectedSize),
        variantSku: toStr(item?.variant?.sku),
        snapshotSku: toStr(item?.productSnapshot?.sku),
        attrs: JSON.stringify(item?.variant?.attributes || []),
      };

      // ✅ apply
      item.selectedSize = f.itemSize;
      item.productSnapshot = item.productSnapshot || {};
      item.productSnapshot.sku = f.itemSku;

      item.variant = item.variant || {};
      item.variant.sku = f.itemSku;
      item.variant.attributes = upsertSizeAttr(item.variant.attributes, f.itemSize);

      const after = {
        selectedSize: toStr(item.selectedSize),
        variantSku: toStr(item?.variant?.sku),
        snapshotSku: toStr(item?.productSnapshot?.sku),
        attrs: JSON.stringify(item?.variant?.attributes || []),
      };

      const changed =
        JSON.stringify(before) !== JSON.stringify(after);

      if (changed) {
        stats.itemsChanged++;
        changedThisOrder = true;

        console.log(
          `✅ ${DRY_RUN ? "[DRY]" : "[COMMIT]"} ${orderNumber} | Item# ${f.itemNo1} (${foundBy})`
        );
        console.log("   before:", before);
        console.log("   after :", after);
      }
    }

    if (changedThisOrder) {
      stats.ordersUpdated++;
      if (!DRY_RUN) {
        await order.save(); // your schema pre-validate hooks will run; that's fine
      }
    }
  }

  console.log("\n=========== SUMMARY ===========");
  console.log(stats);
  console.log("================================");

  await mongoose.disconnect();
  console.log("✅ Done");
}

main().catch((e) => {
  console.error("❌ Script failed:", e);
  process.exit(1);
});
