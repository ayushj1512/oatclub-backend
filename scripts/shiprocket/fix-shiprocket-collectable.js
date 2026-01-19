/**
 * Shiprocket Adhoc Update — fix collectable/sub_total by resending required fields.
 * - Fetches existing order from Shiprocket
 * - Preserves required fields
 * - Updates ONLY price (selling_price/sub_total/collectable_amount)
 *
 * Usage:
 *   node scripts/shiprocket/fix-shiprocket-collectable.js MIRAY-000024 799 7865956865
 *   node scripts/shiprocket/fix-shiprocket-collectable.js 1142374944 799 7865956865
 *
 * Notes:
 * - NO MongoDB
 * - NO .env (hardcoded creds as requested)
 * - Phone must be REAL (Shiprocket masks it as xxxxxxxxxx in API)
 */

import axios from "axios";

const API_BASE = "https://apiv2.shiprocket.in/v1/external";

// ✅ Hardcoded creds (as requested)
const SHIPROCKET_EMAIL = "miray.ayushjuneja@gmail.com";
const SHIPROCKET_PASSWORD = "fowZiQLD4SVRtr8GPj3@4#pMz88SPljM";

const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v) => (v == null ? "" : String(v)).trim();

const cleanPhone = (v) => str(v).replace(/[^\d]/g, "");
const isValidIndianPhone = (p) => /^[6-9]\d{9}$/.test(p);

async function shiprocketLogin() {
  const res = await axios.post(`${API_BASE}/auth/login`, {
    email: SHIPROCKET_EMAIL,
    password: SHIPROCKET_PASSWORD,
  });
  const token = res?.data?.token;
  if (!token) throw new Error("Shiprocket login failed (no token).");
  return token;
}

async function fetchOrderByNumericId(token, id) {
  const res = await axios.get(`${API_BASE}/orders/show/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

async function fetchOrderByChannelOrderId(token, channelOrderId) {
  // Shiprocket supports search via /orders?search=<channel_order_id>
  const res = await axios.get(`${API_BASE}/orders`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { search: channelOrderId },
  });

  const list = res?.data?.data || res?.data?.orders || [];
  const hit =
    (Array.isArray(list) ? list : []).find(
      (o) => str(o?.channel_order_id) === str(channelOrderId)
    ) || null;

  if (!hit?.id) return null;
  return fetchOrderByNumericId(token, hit.id);
}

async function fetchPickupLocations(token) {
  // Shiprocket pickup list endpoint (commonly used)
  const res = await axios.get(`${API_BASE}/settings/company/pickup`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // Different accounts return slightly different shapes; normalize
  const data = res?.data?.data || res?.data || {};
  const arr =
    data?.shipping_address ||
    data?.pickup_address ||
    data?.data ||
    data?.addresses ||
    [];

  return Array.isArray(arr) ? arr : [];
}

function choosePickupLocationName(existingOrder, pickupList) {
  const data = existingOrder?.data || existingOrder || {};

  // Prefer what order already has (and what Shiprocket expects as name):
  // pickup_address.pickup_code is usually "Home"
  const fromOrder =
    str(data?.pickup_address?.pickup_code) ||
    str(data?.pickup_address?.pickup_location) ||
    str(data?.pickup_code) ||
    "";

  if (fromOrder) return fromOrder;

  // If order didn't carry it, pick from list:
  // Prefer "Home" if present, else first pickup_location value
  const home =
    (pickupList || []).find((p) => str(p.pickup_location).toLowerCase() === "home") ||
    (pickupList || []).find((p) => str(p.pickup_code).toLowerCase() === "home") ||
    null;

  if (home) return str(home.pickup_location) || str(home.pickup_code) || "Home";

  const first = (pickupList || [])[0] || null;
  if (first) return str(first.pickup_location) || str(first.pickup_code) || "Home";

  return "Home";
}

async function updateAdhoc(token, payload) {
  const res = await axios.post(`${API_BASE}/orders/update/adhoc`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

function buildRequiredPayloadFromExisting(existing, newNetAmount, overridePhone, pickupLocationName) {
  const data = existing?.data || existing || {};

  const channelOrderId = str(data.channel_order_id);
  if (!channelOrderId) throw new Error("Could not read channel_order_id from Shiprocket order.");

  // customer name
  const fullName = str(data.customer_name) || "Customer";
  const lastName = str(fullName.split(" ").slice(1).join(" ")) || "NA";

  // address
  const address1 = str(data.customer_address) || "NA";
  const address2 = str(data.customer_address_2) || "";
  const city = str(data.customer_city) || "NA";
  const state = str(data.customer_state) || "NA";
  const country = str(data.customer_country) || "India";
  const pincode = str(data.customer_pincode) || "000000";

  const email = str(data.customer_email) || str(data.billing_email) || "na@example.com";

  // ✅ phone MUST be real (Shiprocket masks in show response)
  const phone = cleanPhone(overridePhone);
  if (!isValidIndianPhone(phone)) {
    throw new Error(
      `Invalid phone passed. Need 10-digit Indian mobile starting 6-9. Got: ${overridePhone}`
    );
  }

  // dims/weight
  const shipment = data.shipments || {};
  const length = toNum(shipment.length) || 10;
  const breadth = toNum(shipment.breadth) || 10;
  const height = toNum(shipment.height) || 5;
  const weight = toNum(shipment.weight) || 0.5;

  // items
  const products = Array.isArray(data.products) ? data.products : [];
  if (!products.length) throw new Error("No products found in Shiprocket order data.");

  // proportional split for multi-item orders
  const oldTotals = products.map((p) => {
    const qty = Math.max(1, toNum(p.quantity) || 1);
    const selling = Math.max(
      0,
      toNum(p.selling_price) || toNum(p.mrp) || toNum(p.price) || 0
    );
    return { qty, selling, line: qty * selling };
  });
  const oldGrand = oldTotals.reduce((s, x) => s + x.line, 0) || 1;

  let remaining = Math.round(newNetAmount);

  const order_items = products.map((p, idx) => {
    const sku = str(p.sku || p.channel_sku || "SKU");
    const name = str(p.name || "Item");
    const qtyNum = Math.max(1, toNum(p.quantity) || 1);
    const qty = String(qtyNum);

    let lineNet = Math.round((newNetAmount * oldTotals[idx].line) / oldGrand);
    if (idx === products.length - 1) lineNet = remaining;
    remaining -= lineNet;

    const unitNet = Math.max(0, Math.round(lineNet / qtyNum));

    return {
      name,
      sku,
      units: qty,
      selling_price: String(unitNet),
      discount: "0",
    };
  });

  const sub_total = order_items.reduce(
    (s, it) => s + toNum(it.selling_price) * toNum(it.units),
    0
  );

  return {
    order_id: channelOrderId,
    order_date: new Date().toISOString(),

    // ✅ MUST match EXACT pickup location name in Shiprocket (e.g. "Home")
    pickup_location: pickupLocationName || "Home",

    shipping_is_billing: true,

    billing_customer_name: fullName,
    billing_last_name: lastName,
    billing_address: address1,
    billing_address_2: address2,
    billing_city: city,
    billing_state: state,
    billing_country: country,
    billing_phone: phone,
    billing_email: email,
    billing_pincode: pincode,

    payment_method: "COD",

    order_items,

    // ✅ your desired payable
    sub_total: sub_total,
    collectable_amount: sub_total,

    length,
    breadth,
    height,
    weight,
  };
}

async function main() {
  const idOrOrderNo = str(process.argv[2]); // 1142374944 or MIRAY-000024
  const newAmount = toNum(process.argv[3]); // 799
  const phoneArg = str(process.argv[4]);    // real 10-digit phone

  if (!idOrOrderNo) {
    console.error("❌ Missing order id. Example: MIRAY-000024 OR 1142374944");
    process.exit(1);
  }
  if (!newAmount || newAmount <= 0) {
    console.error("❌ Invalid amount. Example: 799");
    process.exit(1);
  }
  if (!phoneArg) {
    console.error("❌ Phone is required (Shiprocket masks phone in API). Example: 7865956865");
    process.exit(1);
  }

  const token = await shiprocketLogin();

  let existing = null;

  if (/^\d+$/.test(idOrOrderNo)) {
    existing = await fetchOrderByNumericId(token, idOrOrderNo);
  } else {
    existing = await fetchOrderByChannelOrderId(token, idOrOrderNo);
    if (!existing) {
      throw new Error(
        "Could not find order by channel order id via /orders search. Try script with numeric SR id instead."
      );
    }
  }

  // ✅ Ensure pickup_location is valid
  let pickupList = [];
  try {
    pickupList = await fetchPickupLocations(token);
  } catch (e) {
    // non-fatal
    pickupList = [];
  }

  const pickupLocationName = choosePickupLocationName(existing, pickupList);

  const payload = buildRequiredPayloadFromExisting(
    existing,
    newAmount,
    phoneArg,
    pickupLocationName
  );

  console.log("🧾 Updating price while preserving required fields:", {
    order_id: payload.order_id,
    pickup_location: payload.pickup_location,
    sub_total: payload.sub_total,
    collectable_amount: payload.collectable_amount,
    billing_phone: payload.billing_phone,
    items: payload.order_items.map((x) => ({
      sku: x.sku,
      units: x.units,
      selling_price: x.selling_price,
    })),
  });

  const updated = await updateAdhoc(token, payload);

  console.log("✅ Shiprocket update response:\n", JSON.stringify(updated, null, 2));
}

main().catch((e) => {
  console.error("❌ Failed:", e?.response?.data || e?.message || e);
  process.exit(1);
});
