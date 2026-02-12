/* scripts/import-shiprocket-orders.js */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import mongoose from "mongoose";
import { parse } from "csv-parse/sync";
import "dotenv/config"; // ✅ loads .env

import Order from "../Orders/Orders.js";
import Product from "../Products/Products.js";

// OPTIONAL: If you have Customer model, import it; else keep null
let Customer = null;
try {
  Customer = (await import("../Customers/Customer.js")).default;
} catch (_) {
  Customer = null;
}

/* ---------------------------
   Config
--------------------------- */
const DEFAULT_CSV_REL_PATH =
  "scripts\\secure_8239631_reports_1770726380578303924-048db1af074a10e3fcdac2aa18a6fc2a-.csv";

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error("❌ Missing env: MONGO_URI (or MONGODB_URI) in .env");
  process.exit(1);
}

/* ---------------------------
   Helpers
--------------------------- */
const norm = (s) => String(s ?? "").trim();
const lower = (s) => norm(s).toLowerCase();

const toNum = (v, fb = 0) => {
  const raw = String(v ?? "");
  const cleaned = raw.replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fb;
};

const toISODate = (v) => {
  const s = norm(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const stableObjectIdFromString = (s) => {
  const hex = crypto
    .createHash("sha1")
    .update(String(s || "x"))
    .digest("hex")
    .slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
};

const sizeFromSku = (sku) => {
  const s = norm(sku);
  const m = s.match(/-(XXXL|XXL|XL|L|M|S|XS)$/i);
  return m ? m[1].toUpperCase() : "";
};

const statusMap = (srStatusRaw) => {
  const s = lower(srStatusRaw);

  if (s.includes("deliver"))
    return { fulfillmentStatus: "delivered", shipmentStatus: "delivered" };
  if (s.includes("out for delivery"))
    return {
      fulfillmentStatus: "out_for_delivery",
      shipmentStatus: "out_for_delivery",
    };
  if (s.includes("ship") || s.includes("in transit"))
    return { fulfillmentStatus: "shipped", shipmentStatus: "shipped" };
  if (s.includes("pick"))
    return { fulfillmentStatus: "picked", shipmentStatus: "processing" };
  if (s.includes("cancel"))
    return { fulfillmentStatus: "cancelled", shipmentStatus: "cancelled" };
  if (s.includes("rto")) return { fulfillmentStatus: "rto", shipmentStatus: "rto" };

  // default safe
  return { fulfillmentStatus: "processing", shipmentStatus: "pending" };
};

const pickVariantSize = (variantDoc) => {
  const attrs = Array.isArray(variantDoc?.attributes) ? variantDoc.attributes : [];
  const size =
    attrs.find((a) => lower(a?.key) === "size")?.value ||
    attrs.find((a) => lower(a?.key) === "sizes")?.value ||
    "";
  return norm(size);
};

const mapVariantAttributes = (variantDoc) => {
  const attrs = Array.isArray(variantDoc?.attributes) ? variantDoc.attributes : [];
  return attrs
    .map((a) => ({ key: norm(a?.key), value: norm(a?.value) }))
    .filter((a) => a.key && a.value);
};

async function upsertCustomerId(row) {
  const email = norm(row["Customer Email"]);
  const phone = norm(row["Customer Mobile"]);
  const name = norm(row["Customer Name"]);

  if (Customer) {
    const q = email ? { email } : phone ? { phone } : null;
    if (q) {
      const doc = await Customer.findOneAndUpdate(
        q,
        { $set: { email, phone, name } },
        { new: true, upsert: true }
      );
      return doc._id;
    }
  }

  return stableObjectIdFromString(email || phone || name || crypto.randomUUID());
}

function buildAddress(row) {
  return {
    fullName: norm(row["Customer Name"]),
    phone: norm(row["Customer Mobile"]),
    email: norm(row["Customer Email"]),
    line1: norm(row["Address Line 1"]),
    line2: norm(row["Address Line 2"]),
    city: norm(row["Address City"]),
    state: norm(row["Address State"]),
    country: "India",
    pincode: norm(row["Address Pincode"]),
  };
}

/* ---------------------------
   Product lookup
--------------------------- */
async function findProductBySku(sku) {
  const s = norm(sku);
  if (!s) return null;

  return (
    (await Product.findOne({
      $or: [{ sku: s }, { "variants.sku": s }],
    }).lean()) || null
  );
}

function findVariantInProduct(productDoc, sku) {
  const s = norm(sku);
  if (!productDoc || !s) return null;
  const variants = Array.isArray(productDoc.variants) ? productDoc.variants : [];
  return variants.find((v) => norm(v?.sku) === s) || null;
}

/* ---------------------------
   Build item
--------------------------- */
async function buildItem(row) {
  const qty = Math.max(1, toNum(row["Product Quantity"], 1));
  const rowPrice = toNum(row["Product Price"], 0);

  const sku = norm(row["Master SKU"]) || norm(row["Channel SKU"]) || "";
  const skuSize = sizeFromSku(sku);

  const rowTitle = norm(row["Product Name"]) || "Unknown Product";
  const rowHsn = norm(row["Product HSN"]) || "";
  const rowWeight = toNum(row["Weight (KG)"], 0);

  const lineId = crypto.randomUUID();

  // fallback defaults
  let productId = stableObjectIdFromString(`p:${sku || rowTitle}`);
  let productSnapshot = {
    productCode: "",
    title: rowTitle,
    slug: "",
    thumbnail: "",
    images: [],
    productType: "simple",
    sku,
    tags: [],
    hsnCode: rowHsn,
    weight: rowWeight,
    currency: "INR",
  };

  let variantSnap = {
    variantId: null,
    sku,
    attributes: skuSize ? [{ key: "Size", value: skuSize }] : [],
    weight: rowWeight,
  };

  let selectedSize = skuSize || "";

  if (sku) {
    const p = await findProductBySku(sku);
    if (p?._id) {
      productId = new mongoose.Types.ObjectId(String(p._id));

      const pImages = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
      const pThumb = norm(p.thumbnail) || pImages[0] || "";

      const isVariable = Array.isArray(p.variants) && p.variants.length > 0;
      const v = isVariable ? findVariantInProduct(p, sku) : null;

      productSnapshot = {
        productCode: norm(p.productCode) || "",
        title: norm(p.title) || rowTitle,
        slug: norm(p.slug) || "",
        thumbnail: pThumb,
        images: pImages,
        productType: isVariable ? "variable" : "simple",
        sku: norm(p.sku) || sku,
        tags: Array.isArray(p.tags) ? p.tags.map((t) => norm(t)).filter(Boolean) : [],
        hsnCode: norm(p.hsnCode) || rowHsn,
        weight: toNum(p.weight, rowWeight),
        currency: norm(p.currency) || "INR",
      };

      if (v?._id) {
        const attrs = mapVariantAttributes(v);
        const vSize = pickVariantSize(v) || skuSize;

        variantSnap = {
          variantId: new mongoose.Types.ObjectId(String(v._id)),
          sku: norm(v.sku) || sku,
          attributes: attrs.length ? attrs : (vSize ? [{ key: "Size", value: vSize }] : []),
          weight: toNum(v.weight, toNum(p.weight, rowWeight)),
        };

        selectedSize = vSize || selectedSize;
      } else {
        if (!selectedSize) selectedSize = skuSize || "";
      }
    }
  }

  const price = rowPrice;

  return {
    lineId,
    productModel: "Product",
    productId,

    fulfillment: { allocatedQty: 0, shippedQty: 0, toProduceQty: 0 },

    productSnapshot,

    variant: variantSnap,

    selectedSize,
    selectedColor: "",

    quantity: qty,
    price,
    compareAtPrice: null,
    subtotal: price * qty,
  };
}

/* ---------------------------
   Main
--------------------------- */
async function main() {
  const argPath = process.argv[2];
  const csvRelOrAbs = argPath || DEFAULT_CSV_REL_PATH;

  const csvAbs = path.isAbsolute(csvRelOrAbs)
    ? csvRelOrAbs
    : path.resolve(process.cwd(), csvRelOrAbs);

  if (!fs.existsSync(csvAbs)) {
    console.error("❌ CSV file not found:", csvAbs);
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("✅ Mongo connected");

  const raw = fs.readFileSync(csvAbs, "utf8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true });

  const groups = new Map();
  for (const r of rows) {
    const orderId = norm(r["Order ID"]);
    if (!orderId) continue;
    if (!groups.has(orderId)) groups.set(orderId, []);
    groups.get(orderId).push(r);
  }

  console.log(`📦 CSV rows: ${rows.length}, unique orders: ${groups.size}`);

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const [orderId, list] of groups.entries()) {
    try {
      const exists = await Order.exists({ orderNumber: orderId });
      if (exists) {
        skipped++;
        continue;
      }

      const first = list[0];
      const customerId = await upsertCustomerId(first);

      const items = [];
      for (const r of list) items.push(await buildItem(r));

      const subtotal = items.reduce((s, it) => s + Number(it.subtotal || 0), 0);

      const discount = toNum(first["Discount Value"], 0);
      const tax = toNum(first["Tax"], 0);

      const orderTotal = toNum(first["Order Total"], subtotal + tax);
      const codPayable = toNum(first["COD Payble Amount"], 0);

      const pmRaw = lower(first["Payment Method"]);
      const isPrepaid = pmRaw === "prepaid";
      const paymentMethod = isPrepaid ? "razorpay" : "cod";
      const paymentStatus = isPrepaid ? "paid" : "pending";

      const { fulfillmentStatus, shipmentStatus } = statusMap(first["Status"]);

      const createdAt = toISODate(first["Channel Created At"]) || new Date();
      const deliveredAt = toISODate(first["Order Delivered Date"]);
      const shippedAt = toISODate(first["Order Shipped Date"]);

      const awb = norm(first["AWB Code"]);
      const courier = norm(first["Courier Company"]);

      const addr = buildAddress(first);

      const finalTotal = Math.max(0, orderTotal - discount);
      const finalPayable =
        paymentMethod === "cod" ? (codPayable || finalTotal) : finalTotal;

      // ✅ IMPORTANT: Confirm ALL orders by default (to bypass shipping-stage guard)
      const doc = {
        customerId,

        shippingAddressSnapshot: addr,
        billingAddressSnapshot: addr,

        items,
        rmas: [],

        subtotal,
        discount,
        shippingFee: 0,
        tax,

        totalAmount: orderTotal,
        finalPayable,

        currency: "INR",

        coupon: {
          code: "",
          discount: discount || 0,
          finalTotal,
          identity: norm(first["Customer Email"])
            ? `email:${norm(first["Customer Email"])}`
            : "",
        },

        razorpay: {
          orderId: "",
          paymentId: "",
          signature: "",
          amount: isPrepaid ? finalTotal : 0,
          currency: "INR",
          paidAt: isPrepaid ? createdAt : null,
        },

        paymentMethod,
        paymentStatus,

        fulfillmentStatus,

        shipment: {
          provider: "shiprocket",
          shiprocket: {
            orderId: "",
            shipmentId: "",
            awb: awb || "",
            courierName: courier || "",
            trackingUrl: "",
          },
          xpressbees: {
            shipmentId: "",
            awb: "",
            labelUrl: "",
            courierName: "XpressBees",
            trackingUrl: "",
            lastWebhook: null,
            lastTrack: null,
          },
          status: shipmentStatus,
          shippedAt: shippedAt || null,
          deliveredAt: deliveredAt || null,
        },

        trackingDetails: {
          trackingId: awb || "",
          courierName: courier || "",
          trackingUrl: "",
          shippedAt: shippedAt || null,
          deliveredAt: deliveredAt || null,
          expectedDelivery: toISODate(first["EDD"]) || null,
        },

        customerMessage: "",
        adminRemarks: "",
        customerSupportRemark: "",
        queryRef: null,

        orderNumber: orderId,
        orderDate: createdAt,

        source: "website",
        priority: "normal",
        isGiftOrder: false,

        // ✅ FORCE confirm
        isConfirmed: true,
        confirmedAt: createdAt,
        confirmedBy: null,

        analytics: {
          categoryBreakdown: [],
          tagsUsed: [],
          couponApplied: Boolean(discount),
          creditsUsed: false,
          averageItemPrice: items.length
            ? subtotal / (items.reduce((a, it) => a + it.quantity, 0) || 1)
            : 0,
          totalItems: items.reduce((a, it) => a + it.quantity, 0),
          paymentSuccessRate: 0,
          onlinePaymentDiscountApplied: false,
          onlinePaymentDiscountPct: 0,
          onlinePaymentDiscountAmount: 0,
          couponIdentity: norm(first["Customer Email"])
            ? `email:${norm(first["Customer Email"])}`
            : "",
        },

        orderType: "shipment",
        parentOrderId: null,
        splitSuffix: "",

        createdAt,
        updatedAt: new Date(),
      };

      await Order.create(doc);
      inserted++;
    } catch (e) {
      failed++;
      console.error(`❌ Failed for order ${orderId}:`, e?.message || e);
    }
  }

  console.log(
    `✅ Inserted: ${inserted} | Skipped(existing): ${skipped} | Failed: ${failed}`
  );

  await mongoose.disconnect();
  console.log("✅ Done");
}

main().catch((e) => {
  console.error("❌ Import crashed:", e);
  process.exit(1);
});
