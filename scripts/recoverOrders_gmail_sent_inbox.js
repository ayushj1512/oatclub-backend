import "dotenv/config";
import mongoose from "mongoose";
import { google } from "googleapis";
import crypto from "crypto";

import Order from "./models/Order.js";
import Customer from "./models/Customer.js";
import Product from "./Products/Products.js"; // adjust

const {
  MONGO_URI,
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  GMAIL_REDIRECT_URI,
  GMAIL_REFRESH_TOKEN,
  DRY_RUN = "true",
  MAX_EMAILS = "800",
} = process.env;

const IS_DRY = String(DRY_RUN).toLowerCase() === "true";
const MAX = Math.max(1, Number(MAX_EMAILS || 800));

/* ---------------- Gmail ---------------- */
function gmailClient() {
  const auth = new google.auth.OAuth2(
    GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET,
    GMAIL_REDIRECT_URI
  );
  auth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth });
}

async function listAllMessageIds(gmail, { labelIds = [], q = "" }) {
  let ids = [];
  let pageToken = undefined;

  while (ids.length < MAX) {
    const res = await gmail.users.messages.list({
      userId: "me",
      labelIds,
      q,
      maxResults: Math.min(500, MAX - ids.length),
      pageToken,
    });

    const msgs = res.data.messages || [];
    ids.push(...msgs.map((m) => m.id));

    pageToken = res.data.nextPageToken;
    if (!pageToken || msgs.length === 0) break;
  }

  return ids;
}

function b64ToUtf8(data = "") {
  if (!data) return "";
  const s = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(s, "base64").toString("utf8");
}

function findTextPlain(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return payload.body.data;
  const parts = payload.parts || [];
  for (const p of parts) {
    const r = findTextPlain(p);
    if (r) return r;
  }
  return payload.body?.data || "";
}

async function getMessage(gmail, id) {
  const msg = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  const headers = msg.data.payload?.headers || [];
  const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value || "";
  const from = headers.find((h) => h.name.toLowerCase() === "from")?.value || "";
  const date = headers.find((h) => h.name.toLowerCase() === "date")?.value || "";

  const data = findTextPlain(msg.data.payload);
  const body = b64ToUtf8(data);

  return { subject, from, date, body };
}

/* ---------------- Parse helpers ---------------- */
const normalize = (s) => String(s || "").trim();
const moneyToNum = (s) => {
  const t = String(s || "").replace(/,/g, "").replace(/[^\d.]/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};

function parseOrderNumber(text) {
  const m = String(text).match(/\bMIRAY-\d{6}\b/);
  return m ? m[0] : "";
}

function parsePayment(text) {
  const m = String(text).match(/Payment:\s*([^\n]+)/i);
  const raw = (m ? m[1] : "").trim().toLowerCase();

  let paymentMethod = "cod";
  if (raw.includes("razorpay")) paymentMethod = "razorpay";
  if (raw.includes("exchange")) paymentMethod = "exchange";

  let paymentStatus = "pending";
  if (raw.includes("paid")) paymentStatus = "paid";
  if (raw.includes("failed")) paymentStatus = "failed";
  if (raw.includes("refunded")) paymentStatus = "refunded";
  if (paymentMethod === "exchange") paymentStatus = "not_applicable";

  return { paymentMethod, paymentStatus };
}

function parseFulfillment(text) {
  const m = String(text).match(/Fulfillment:\s*([^\n]+)/i);
  const raw = (m ? m[1] : "").trim().toLowerCase();
  if (!raw) return "processing";

  if (raw.includes("packed")) return "packed";
  if (raw.includes("picked")) return "picked";
  if (raw.includes("shipped")) return "shipped";
  if (raw.includes("out")) return "out_for_delivery";
  if (raw.includes("delivered")) return "delivered";
  return "processing";
}

function parseItems(text) {
  // expects: "1. Title — Qty: 1 — ₹799"
  const lines = String(text).split("\n").map((l) => l.trim()).filter(Boolean);
  const items = [];

  for (const l of lines) {
    const m = l.match(
      /^\d+\.\s*(.+?)\s+—\s+Qty:\s*(\d+)\s+—\s+₹\s*([\d,]+(\.\d+)?)/i
    );
    if (!m) continue;

    const title = m[1].replace(/\(\s*\d+:\s*\[object Object\]\s*\)/g, "").trim();
    const quantity = Math.max(1, Number(m[2] || 1));
    const price = moneyToNum(m[3]);

    items.push({ title, quantity, price, subtotal: price * quantity });
  }
  return items;
}

function parseSummary(text) {
  const pick = (label) => {
    const re = new RegExp(`${label}:\\s*₹\\s*([\\d,]+(\\.\\d+)?)`, "i");
    const m = String(text).match(re);
    return m ? moneyToNum(m[1]) : null;
  };

  const subtotal = pick("Subtotal") ?? 0;
  const shippingFee = pick("Shipping") ?? 0;
  const tax = pick("Tax") ?? 0;
  const finalPayable = pick("Total Payable") ?? pick("Total") ?? (subtotal + shippingFee + tax);

  return {
    subtotal,
    shippingFee,
    tax,
    totalAmount: subtotal + shippingFee + tax,
    finalPayable,
  };
}

function parseShippingBlock(text) {
  // tries: Shipping Address: block
  const m = String(text).match(/Shipping Address:\s*([\s\S]+?)(\n\n|$)/i);
  if (!m) return null;

  const block = m[1].trim();
  const lines = block.split("\n").map((x) => x.trim()).filter(Boolean);

  const fullName = lines[0] || "";
  const line1 = lines[1] || "";
  const cityStatePin = lines[2] || "";
  const phoneLine = lines.find((l) => l.toLowerCase().startsWith("phone:")) || "";
  const phone = phoneLine.replace(/phone:\s*/i, "").trim();

  const parts = cityStatePin.split(",").map((x) => x.trim());
  const city = parts[0] || "";
  const state = parts[1] || "";
  const pincode = parts[2] || "";

  return {
    fullName,
    phone,
    email: "",
    line1,
    line2: "",
    city,
    state,
    country: "India",
    pincode,
  };
}

/* ---------------- DB resolve helpers ---------------- */
async function resolveCustomerId({ phone, email, name }) {
  const q = {};
  if (phone) q.phone = phone;
  if (!phone && email) q.email = email;
  if (!q.phone && !q.email) return null;

  let c = await Customer.findOne(q).select("_id");
  if (c?._id) return c._id;

  if (IS_DRY) return null;

  c = await Customer.create({
    name: name || "Customer",
    phone: phone || "",
    email: email || "",
  });
  return c._id;
}

async function resolveProductByTitle(title) {
  const t = normalize(title);
  if (!t) return null;

  // best-effort title match
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return await Product.findOne({ title: new RegExp(`^${esc}$`, "i") })
    .select("_id title slug productCode images sku tags hsnCode weight");
}

/* ---------------- merge + conflict rules ---------------- */
function isEmptyVal(v) {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

function shallowConflict(existing, incoming) {
  // If existing already has items + totals, and incoming differs a lot -> conflict
  const exItems = existing?.items || [];
  const inItems = incoming?.items || [];
  if (exItems.length && inItems.length) {
    // compare count + titles+qty+price signature
    const sig = (arr) =>
      arr
        .map((x) => `${normalize(x?.productSnapshot?.title || x?.title)}|${x.quantity}|${Number(x.price||0)}`)
        .sort()
        .join(";;");
    if (sig(exItems) !== sig(inItems)) return "items_mismatch";
  }

  const exFinal = Number(existing?.finalPayable || 0);
  const inFinal = Number(incoming?.finalPayable || 0);
  if (exFinal && inFinal && Math.abs(exFinal - inFinal) > 1) return "finalPayable_mismatch";

  return "";
}

function mergeFillOnly(existing, incoming) {
  // only fill blanks in existing; never overwrite non-empty
  const out = existing.toObject ? existing.toObject() : { ...existing };

  const setIfEmpty = (path, val) => {
    // supports 1-level paths used here
    const parts = path.split(".");
    if (parts.length === 1) {
      if (isEmptyVal(out[parts[0]]) && !isEmptyVal(val)) out[parts[0]] = val;
      return;
    }
    // nested
    let ref = out;
    for (let i = 0; i < parts.length - 1; i++) {
      ref[parts[i]] = ref[parts[i]] || {};
      ref = ref[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (isEmptyVal(ref[last]) && !isEmptyVal(val)) ref[last] = val;
  };

  // core
  setIfEmpty("shippingAddressSnapshot", incoming.shippingAddressSnapshot);
  setIfEmpty("billingAddressSnapshot", incoming.billingAddressSnapshot);

  setIfEmpty("paymentMethod", incoming.paymentMethod);
  setIfEmpty("paymentStatus", incoming.paymentStatus);
  setIfEmpty("fulfillmentStatus", incoming.fulfillmentStatus);

  setIfEmpty("subtotal", incoming.subtotal);
  setIfEmpty("shippingFee", incoming.shippingFee);
  setIfEmpty("tax", incoming.tax);
  setIfEmpty("totalAmount", incoming.totalAmount);
  setIfEmpty("finalPayable", incoming.finalPayable);

  // items: if existing has none, fill
  if ((out.items || []).length === 0 && (incoming.items || []).length) out.items = incoming.items;

  // customerId: if missing
  if (!out.customerId && incoming.customerId) out.customerId = incoming.customerId;

  return out;
}

/* ---------------- Main ---------------- */
async function main() {
  if (!MONGO_URI) throw new Error("MONGO_URI missing");
  await mongoose.connect(MONGO_URI);

  const gmail = gmailClient();

  const q = [
    '(subject:"Order Confirmed" OR subject:"New Order Received")',
    '"MIRAY-"',
  ].join(" ");

  // ✅ SENT + INBOX
  const [sentIds, inboxIds] = await Promise.all([
    listAllMessageIds(gmail, { labelIds: ["SENT"], q }),
    listAllMessageIds(gmail, { labelIds: ["INBOX"], q }),
  ]);

  const allIds = Array.from(new Set([...sentIds, ...inboxIds]));
  console.log("SENT:", sentIds.length, "INBOX:", inboxIds.length, "UNIQUE:", allIds.length);

  // bucket by orderNumber
  const bucket = new Map(); // orderNumber -> { sources: [] }

  for (const id of allIds) {
    const msg = await getMessage(gmail, id);
    const orderNumber = parseOrderNumber(msg.subject + "\n" + msg.body);
    if (!orderNumber) continue;

    const pack = bucket.get(orderNumber) || { sources: [] };
    pack.sources.push(msg);
    bucket.set(orderNumber, pack);
  }

  console.log("Orders found in email:", bucket.size);

  let created = 0;
  let updated = 0;
  let conflicts = 0;
  let skipped = 0;

  for (const [orderNumber, pack] of bucket.entries()) {
    // Build a single "best" text (prefer longer bodies)
    const sources = pack.sources.sort((a, b) => (b.body?.length || 0) - (a.body?.length || 0));
    const mergedText = sources.map((s) => `${s.subject}\n${s.body}`).join("\n\n-----\n\n");

    const shipping = parseShippingBlock(mergedText) || {
      fullName: "",
      phone: "",
      email: "",
      line1: "",
      line2: "",
      city: "",
      state: "",
      country: "India",
      pincode: "",
    };

    const { paymentMethod, paymentStatus } = parsePayment(mergedText);
    const fulfillmentStatus = parseFulfillment(mergedText);
    const summary = parseSummary(mergedText);
    const rawItems = parseItems(mergedText);

    const customerId = await resolveCustomerId({
      phone: shipping.phone,
      email: shipping.email,
      name: shipping.fullName,
    });

    // Build items in your schema shape (best-effort product resolve)
    const items = [];
    for (const it of rawItems) {
      const prod = await resolveProductByTitle(it.title);

      // if productId is required in your schema, and prod missing => we still add a placeholder,
      // OR you can choose to skip item. Here: placeholder to keep order recoverable.
      const pid = prod?._id || new mongoose.Types.ObjectId("000000000000000000000000");

      items.push({
        lineId: crypto.randomUUID(),
        productModel: "Product",
        productId: pid,
        fulfillment: { allocatedQty: 0, shippedQty: 0, toProduceQty: 0 },
        productSnapshot: {
          productCode: prod?.productCode || "",
          title: it.title,
          slug: prod?.slug || "",
          thumbnail: (prod?.images && prod.images[0]) || "",
          images: Array.isArray(prod?.images) ? prod.images : [],
          productType: "simple",
          sku: prod?.sku || "",
          tags: Array.isArray(prod?.tags) ? prod.tags : [],
          hsnCode: prod?.hsnCode || "",
          weight: Number(prod?.weight || 0),
          currency: "INR",
        },
        variant: { variantId: null, sku: "", attributes: [], weight: 0 },
        selectedSize: "",
        selectedColor: "",
        quantity: it.quantity,
        price: it.price,
        compareAtPrice: null,
        subtotal: it.subtotal,
      });
    }

    const incoming = {
      orderNumber,
      orderDate: new Date(), // if you have a reliable date pattern in email, we can parse later
      source: "website",
      priority: "normal",
      currency: "INR",

      customerId: customerId || null,
      shippingAddressSnapshot: shipping,
      billingAddressSnapshot: shipping,

      items,

      subtotal: summary.subtotal,
      shippingFee: summary.shippingFee,
      tax: summary.tax,
      totalAmount: summary.totalAmount,
      discount: 0,
      finalPayable: summary.finalPayable,

      paymentMethod,
      paymentStatus,
      fulfillmentStatus,

      isConfirmed: false,
    };

    const existing = await Order.findOne({ orderNumber });
    if (!existing) {
      if (IS_DRY) {
        created++;
        continue;
      }
      await Order.create(incoming);
      created++;
      continue;
    }

    // If exists: check conflict
    const c = shallowConflict(existing, incoming);
    if (c) {
      conflicts++;
      console.log("CONFLICT SKIP:", orderNumber, c);
      continue;
    }

    // merge only missing fields
    const merged = mergeFillOnly(existing, incoming);

    // if nothing changes, skip
    const before = JSON.stringify(existing.toObject());
    const after = JSON.stringify(merged);
    if (before === after) {
      skipped++;
      continue;
    }

    if (IS_DRY) {
      updated++;
      continue;
    }

    await Order.updateOne({ _id: existing._id }, { $set: merged }, { runValidators: true });
    updated++;
  }

  console.log({
    DRY_RUN: IS_DRY,
    created,
    updated,
    conflicts,
    skipped,
    totalOrdersFromEmail: bucket.size,
  });

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
