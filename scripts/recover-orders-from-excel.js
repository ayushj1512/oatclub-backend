import "dotenv/config";
import mongoose from "mongoose";
import crypto from "crypto";
import XLSX from "xlsx";

// ✅ Update these import paths as per your project structure
import Order from "../Orders/Orders.js";
import Product from "../Products/Products.js";
import Customer from "../Customer/Customer.js";

/**
 * ENV:
 *  MONGO_URI=...
 * Optional:
 *  XLSX_PATH=scripts/FINAL_order_confirmed_with_products (1).xlsx
 *  DRY_RUN=true|false
 *  MIN_MATCH_SCORE=0.85
 */

const XLSX_PATH =
  process.env.XLSX_PATH || "scripts/FINAL_order_confirmed_with_products (1).xlsx";

const DRY_RUN = String(process.env.DRY_RUN ?? "true").toLowerCase() === "true";
const MIN_MATCH_SCORE = Number(process.env.MIN_MATCH_SCORE || 0.85);

// ---------------- utils ----------------
const toStr = (v) => (v == null ? "" : String(v)).trim();
const toNum = (v, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};
const isMissing = (v) =>
  v === undefined ||
  v === null ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);

const safeDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const normalizePhone = (p) => toStr(p).replace(/[^\d+]/g, "");
const normalizeEmail = (e) => toStr(e).toLowerCase();

function mergeMissingSnapshot(existing = {}, incoming = {}) {
  const out = { ...(existing || {}) };
  for (const [k, v] of Object.entries(incoming || {})) {
    if (isMissing(out[k]) && !isMissing(v)) out[k] = v;
  }
  return out;
}

function setIfMissing(obj, key, value) {
  if (!obj) return;
  if (isMissing(obj[key]) && !isMissing(value)) obj[key] = value;
}

function setIfZeroOrMissing(obj, key, value) {
  if (!obj) return;
  const cur = toNum(obj[key], 0);
  const inc = toNum(value, 0);
  if ((obj[key] == null || cur === 0) && inc !== 0) obj[key] = inc;
}

function itemsConflict(existingItems, incomingLines) {
  const a = Array.isArray(existingItems) ? existingItems : [];
  const b = Array.isArray(incomingLines) ? incomingLines : [];
  if (a.length && b.length && a.length !== b.length) return true;
  return false;
}

// ---------------- read excel ----------------
function readExcel(path) {
  const wb = XLSX.readFile(path);

  const sheetOrders = wb.Sheets["orders_unique"];
  const sheetItems =
    wb.Sheets["line_items_with_products"] || wb.Sheets["line_items_deduped"];

  if (!sheetOrders) throw new Error("Missing sheet: orders_unique");
  if (!sheetItems)
    throw new Error("Missing sheet: line_items_with_products (or line_items_deduped)");

  const orders = XLSX.utils.sheet_to_json(sheetOrders, { defval: "" });
  const items = XLSX.utils.sheet_to_json(sheetItems, { defval: "" });

  if (!orders.length) throw new Error("orders_unique is empty");
  if (!items.length) throw new Error("line_items sheet is empty");

  return { orders, items };
}

// ---------------- customer find/create ----------------
async function getOrCreateCustomerFromRow(row) {
  const email = normalizeEmail(row.email);
  const phone = normalizePhone(row.phone);
  const name = toStr(row.customerName);

  // 1) Prefer email match (if exists)
  if (email) {
    const byEmail = await Customer.findOne({ email }).lean();
    if (byEmail?._id) return byEmail;
  }

  // 2) fallback to phone match (if exists)
  if (phone) {
    const byPhone = await Customer.findOne({ phone }).lean();
    if (byPhone?._id) return byPhone;
  }

  // 3) create new guest customer
  const doc = new Customer({
    name,
    email: email || "",
    phone: phone || "",
    country: toStr(row.country) || "India",
    state: toStr(row.state) || "",
    city: toStr(row.city) || "",
    isActive: true,
    joinedAt: new Date(),
  });

  if (DRY_RUN) {
    // fake return for dry run
    return { _id: new mongoose.Types.ObjectId(), name, email, phone };
  }

  const saved = await doc.save();
  return saved.toObject();
}

// ---------------- product lookup ----------------
async function findProductForLine(li) {
  const matchScore = toNum(li.matchScore, 0);
  if (matchScore && matchScore < MIN_MATCH_SCORE) return null;

  const sku = toStr(li.productSku);
  const productCode = toStr(li.productCode);
  const url = toStr(li.productUrl);

  // 1) SKU (product sku OR variant sku)
  if (sku) {
    const bySku = await Product.findOne({
      $or: [{ sku }, { "variants.sku": sku }],
    }).lean();
    if (bySku) return { product: bySku, matchedBy: "sku" };
  }

  // 2) productCode
  if (productCode) {
    const byCode = await Product.findOne({ productCode }).lean();
    if (byCode) return { product: byCode, matchedBy: "productCode" };
  }

  // 3) slug from URL
  if (url) {
    const m =
      url.match(/\/products\/([^/?#]+)/i) || url.match(/\/product\/([^/?#]+)/i);
    const slug = m?.[1] ? String(m[1]).toLowerCase() : "";
    if (slug) {
      const bySlug = await Product.findOne({ slug }).lean();
      if (bySlug) return { product: bySlug, matchedBy: "slug" };
    }
  }

  return null;
}

function buildOrderItemFromLine(li, productHit) {
  const qty = Math.max(1, toNum(li.quantity, 1));
  const price = toNum(li.price, 0);
  const subtotal = toNum(li.itemSubtotal, price * qty);

  const item = {
    lineId: crypto.randomUUID(),
    productModel: "Product",
    productId: null, // required for inserts

    fulfillment: { allocatedQty: 0, shippedQty: 0, toProduceQty: 0 },

    productSnapshot: {
      productCode: "",
      title: toStr(li.title) || "Untitled",
      slug: "",
      thumbnail: "",
      images: [],
      productType: "simple",
      sku: "",
      tags: [],
      hsnCode: "",
      weight: 0,
      currency: "INR",
    },

    variant: { variantId: null, sku: "", attributes: [], weight: 0 },

    selectedSize: toStr(li.selectedSize),
    selectedColor: toStr(li.selectedColor),

    quantity: qty,
    price,
    compareAtPrice: null,
    subtotal,
  };

  const p = productHit?.product;
  if (p?._id) {
    item.productId = p._id;

    item.productSnapshot.productCode = toStr(p.productCode);
    item.productSnapshot.title = toStr(p.title) || item.productSnapshot.title;
    item.productSnapshot.slug = toStr(p.slug);
    item.productSnapshot.thumbnail = toStr(p.thumbnail);
    item.productSnapshot.images = Array.isArray(p.images) ? p.images : [];
    item.productSnapshot.productType = toStr(p.productType) || "simple";
    item.productSnapshot.sku = toStr(p.sku);
    item.productSnapshot.tags = Array.isArray(p.tags) ? p.tags : [];
    item.productSnapshot.hsnCode = toStr(p.hsnCode);
    item.productSnapshot.weight = toNum(p.weight, 0);
    item.productSnapshot.currency = toStr(p.currency) || "INR";

    // attach variant if SKU matches a variant
    const sku = toStr(li.productSku);
    if (sku && Array.isArray(p.variants) && p.variants.length) {
      const v = p.variants.find((x) => toStr(x?.sku) === sku);
      if (v?._id) {
        item.variant.variantId = v._id;
        item.variant.sku = toStr(v.sku);
        item.variant.attributes = (v.attributes || []).map((a) => ({
          key: toStr(a.key || a.attribute || ""),
          value: toStr(a.value || ""),
        }));
        item.variant.weight = toNum(v.weight, 0);
      }
    }
  }

  return item;
}

function mergeItemsByIndex(existingItems, incomingItems) {
  return (existingItems || []).map((ei, idx) => {
    const inc = incomingItems[idx];
    if (!inc) return ei;

    const out = { ...ei };

    if (!out.lineId) out.lineId = crypto.randomUUID();

    if (!out.productId && inc.productId) out.productId = inc.productId;

    out.productSnapshot = mergeMissingSnapshot(
      out.productSnapshot || {},
      inc.productSnapshot || {}
    );

    out.variant = out.variant || { variantId: null, sku: "", attributes: [], weight: 0 };

    if (!out.variant.variantId && inc.variant?.variantId)
      out.variant.variantId = inc.variant.variantId;

    if (isMissing(out.variant.sku) && !isMissing(inc.variant?.sku))
      out.variant.sku = inc.variant.sku;

    if (
      (!Array.isArray(out.variant.attributes) || out.variant.attributes.length === 0) &&
      Array.isArray(inc.variant?.attributes) &&
      inc.variant.attributes.length
    ) {
      out.variant.attributes = inc.variant.attributes;
    }

    if (isMissing(out.selectedSize) && !isMissing(inc.selectedSize))
      out.selectedSize = inc.selectedSize;

    if (isMissing(out.selectedColor) && !isMissing(inc.selectedColor))
      out.selectedColor = inc.selectedColor;

    if (!toNum(out.quantity, 0) && toNum(inc.quantity, 0)) out.quantity = inc.quantity;
    if (!toNum(out.price, 0) && toNum(inc.price, 0)) out.price = inc.price;
    if (!toNum(out.subtotal, 0) && toNum(inc.subtotal, 0)) out.subtotal = inc.subtotal;

    return out;
  });
}

// ---------------- main ----------------
async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGO_URI in .env");

  const { orders, items } = readExcel(XLSX_PATH);

  // Group items by orderNumber
  const itemsByOrder = new Map();
  for (const it of items) {
    const on = toStr(it.orderNumber);
    if (!on) continue;
    if (!itemsByOrder.has(on)) itemsByOrder.set(on, []);
    itemsByOrder.get(on).push(it);
  }

  await mongoose.connect(uri);
  console.log("✅ Mongo connected");
  console.log("📄 Excel:", XLSX_PATH);
  console.log("🧪 DRY_RUN:", DRY_RUN);

  const report = {
    excelOrders: orders.length,

    // update existing
    dbFound: 0,
    updated: 0,
    skippedConflicts: 0,

    // insert missing
    dbMissing: 0,
    inserted: 0,
    insertSkipped_noProduct: 0,

    // product stats
    productAttached: 0,
    productNotFound: 0,
  };

  for (const row of orders) {
    const orderNumber = toStr(row.orderNumber);
    if (!orderNumber) continue;

    const incomingLines = (itemsByOrder.get(orderNumber) || [])
      .slice()
      .sort((a, b) => toNum(a.lineNo, 0) - toNum(b.lineNo, 0));

    const shipping = {
      fullName: toStr(row.customerName),
      phone: normalizePhone(row.phone),
      email: normalizeEmail(row.email),
      line1: toStr(row.addressLine1),
      line2: "",
      city: toStr(row.city),
      state: toStr(row.state),
      country: toStr(row.country) || "India",
      pincode: toStr(row.pincode),
    };

    const orderDate = safeDate(row.emailDate) || new Date();

    // Prepare order items from excel (with product linking)
    const builtItems = [];
    let allProductResolved = true;

    for (const li of incomingLines) {
      const hit = await findProductForLine(li);
      if (hit?.product?._id) report.productAttached += 1;
      else {
        report.productNotFound += 1;
        allProductResolved = false;
      }
      builtItems.push(buildOrderItemFromLine(li, hit));
    }

    // Find existing order
    const existing = await Order.findOne({ orderNumber });

    // ---------------- UPDATE EXISTING ----------------
    if (existing) {
      report.dbFound += 1;

      existing.shippingAddressSnapshot = mergeMissingSnapshot(
        existing.shippingAddressSnapshot || {},
        shipping
      );
      existing.billingAddressSnapshot = mergeMissingSnapshot(
        existing.billingAddressSnapshot || {},
        shipping
      );

      // Totals fill only if missing/0
      setIfZeroOrMissing(existing, "subtotal", row.orderSubtotal);
      setIfZeroOrMissing(existing, "shippingFee", row.shippingFee);
      setIfZeroOrMissing(existing, "tax", row.tax);
      setIfZeroOrMissing(existing, "totalAmount", row.totalAmount);
      setIfZeroOrMissing(existing, "finalPayable", row.finalPayable);

      // Discount/coupon fill if missing
      if (existing.discount == null || toNum(existing.discount, 0) === 0) {
        if (!isMissing(row.discount)) existing.discount = toNum(row.discount, 0);
      }

      existing.coupon = existing.coupon || {};
      setIfMissing(existing.coupon, "code", row.coupon);
      if (existing.coupon.discount == null || toNum(existing.coupon.discount, 0) === 0) {
        if (!isMissing(row.discount)) existing.coupon.discount = toNum(row.discount, 0);
      }

      // Status fill if missing
      setIfMissing(existing, "paymentMethod", row.paymentMethod || "cod");
      setIfMissing(existing, "paymentStatus", row.paymentStatus || "pending");
      setIfMissing(existing, "fulfillmentStatus", row.fulfillmentStatus || "processing");

      // orderDate fill if missing
      if (!existing.orderDate) existing.orderDate = orderDate;

      // Items fill / merge (skip on conflict)
      if (incomingLines.length) {
        const conflict = itemsConflict(existing.items || [], incomingLines);
        if (conflict) {
          report.skippedConflicts += 1;
        } else {
          if (!Array.isArray(existing.items) || existing.items.length === 0) {
            // If DB items empty, we can set full built items (even if some productId missing)
            // BUT in DB schema productId required -> existing items already validated in DB.
            // So only set if allProductResolved
            if (allProductResolved) existing.items = builtItems;
          } else {
            existing.items = mergeItemsByIndex(existing.items, builtItems);
          }
        }
      }

      if (!DRY_RUN) await existing.save();
      report.updated += 1;
      continue;
    }

    // ---------------- INSERT MISSING ----------------
    report.dbMissing += 1;

    // Insert only if all productId resolved (because OrderItem.productId required)
    if (!allProductResolved) {
      report.insertSkipped_noProduct += 1;
      continue;
    }

    const customer = await getOrCreateCustomerFromRow(row);

    const doc = new Order({
      customerId: customer._id,

      shippingAddressSnapshot: shipping,
      billingAddressSnapshot: shipping,

      items: builtItems,

      subtotal: toNum(row.orderSubtotal, 0),
      discount: isMissing(row.discount) ? 0 : toNum(row.discount, 0),

      coupon: {
        code: toStr(row.coupon),
        discount: isMissing(row.discount) ? 0 : toNum(row.discount, 0),
        finalTotal: toNum(row.finalPayable, 0),
        identity: shipping.email || shipping.phone || "",
      },

      shippingFee: toNum(row.shippingFee, 0),
      tax: toNum(row.tax, 0),

      totalAmount: toNum(row.totalAmount, 0),
      finalPayable: toNum(row.finalPayable, 0),

      currency: "INR",

      paymentMethod: toStr(row.paymentMethod) || "cod",
      paymentStatus: toStr(row.paymentStatus) || "pending",
      fulfillmentStatus: toStr(row.fulfillmentStatus) || "processing",

      orderNumber, // from email/excel
      orderDate,

      source: "website",

      // Order Confirmed emails => confirmed
      isConfirmed: true,
      confirmedAt: orderDate,
    });

    if (!DRY_RUN) await doc.save();
    report.inserted += 1;
  }

  await mongoose.disconnect();

  console.log("\n✅ DONE");
  console.table(report);
  console.log("\nNext:");
  console.log("- If DRY_RUN=true and report ok => set DRY_RUN=false and rerun.");
}

main().catch((e) => {
  console.error("❌ ERROR:", e?.message || e);
  process.exit(1);
});
