// nodemailer/events/AdminOrderReceivedTemplate.js

export function orderReceivedAdminTemplate({ order = {}, ctaUrl = "#" }) {
  const orderId = order?.orderNumber || order?._id || "—";
  const currency = order?.currency || "INR";

  const createdAt = order?.createdAt || order?.orderDate;
  const orderDate = createdAt ? formatDate(createdAt) : "";

  const shipping = order?.shippingAddressSnapshot || {};
  const billing = order?.billingAddressSnapshot || {};

  const customerName =
    shipping?.fullName || billing?.fullName || order?.customer?.name || "Customer";

  const customerEmail =
    shipping?.email || billing?.email || order?.customer?.email || "—";

  const customerPhone =
    shipping?.phone || billing?.phone || order?.customer?.phone || "—";

  const shippingAddress = [
    shipping?.fullName,
    shipping?.line1,
    shipping?.line2,
    shipping?.city,
    shipping?.state,
    shipping?.pincode,
    shipping?.country,
  ]
    .filter(Boolean)
    .join(", ");

  const paymentMethod = pretty(order?.paymentMethod || "cod");
  const paymentStatus = pretty(order?.paymentStatus || "pending");
  const fulfillmentStatus = pretty(order?.fulfillmentStatus || "processing");

  const razorpay = order?.razorpay || {};
  const paymentRef =
    razorpay?.paymentId || razorpay?.orderId || order?.transactionId || "—";

  const subtotal = num(order?.subtotal);
  const discount = num(order?.discount);
  const shippingFee = num(order?.shippingFee);
  const tax = num(order?.tax);
  const finalPayable = num(order?.finalPayable || order?.totalAmount);

  const coupon = order?.coupon || {};
  const couponCode = coupon?.code || null;
  const couponDiscount = num(coupon?.discount);

  const items = Array.isArray(order?.items) ? order.items : [];
  const totalQty = items.reduce((sum, it) => sum + num(it?.quantity), 0);

  const source = order?.source || "website";
  const priority = order?.priority || "normal";
  const isGiftOrder = order?.isGiftOrder ? "Yes" : "No";
  const isConfirmed = order?.isConfirmed ? "Yes" : "No";

  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");

  const subject = `New OATCLUB Order Received — #${orderId}`;

  const text = `
NEW OATCLUB ORDER RECEIVED

Order ID: ${orderId}
Order Date: ${orderDate}

Customer:
Name: ${customerName}
Email: ${customerEmail}
Phone: ${customerPhone}

Shipping Address:
${shippingAddress}

Payment:
Method: ${paymentMethod}
Status: ${paymentStatus}
Reference: ${paymentRef}

Fulfillment Status: ${fulfillmentStatus}
Order Confirmed: ${isConfirmed}

Items (${items.length} items | Qty ${totalQty}):
${items.map((it, i) => formatItemText(it, i + 1, currency)).join("\n")}

Pricing:
Subtotal: ${money(subtotal, currency)}
Discount: -${money(discount, currency)}
Shipping: ${money(shippingFee, currency)}
Tax: ${money(tax, currency)}
Final Payable: ${money(finalPayable, currency)}

Coupon:
${couponCode ? `${couponCode} (-${money(couponDiscount, currency)})` : "—"}

Other:
Source: ${source}
Priority: ${priority}
Gift Order: ${isGiftOrder}

${hasValidCta ? `Open Order: ${ctaUrl}` : ""}
`.trim();

  const itemsHtml = items.length
    ? items.map((it) => renderItemRow(it, currency)).join("")
    : emptyCard("No items found.");

  const html = `
<!doctype html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />

<style>
@import url("https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@600;700;800&display=swap");

body{
  margin:0;
  padding:0;
  background:#f2f2f2;
  color:#111111;
  font-family:Poppins,Arial,sans-serif;
  text-transform:uppercase;
}

.oat-bg{
  padding:24px 12px;
  background:#f2f2f2;
}

.oat-shell{
  max-width:720px;
  margin:0 auto;
  background:#ffffff;
  border-radius:22px;
  overflow:hidden;
  box-shadow:0 24px 60px rgba(34,24,18,0.14);
}

.oat-top{
  background:#111111;
  color:#ffffff;
  text-align:center;
  padding:10px 18px;
  font-size:10px;
  font-weight:800;
  letter-spacing:.24em;
}

.oat-header{
  padding:24px 24px 18px;
  text-align:center;
}

.oat-logo-text{
  margin:0;
  display:block;
  text-align:center;
  font-family:"Space Grotesk",Arial,sans-serif;
  font-size:34px;
  line-height:1;
  font-weight:800;
  letter-spacing:.08em;
  color:#111111;
}

.oat-kicker{
  margin:18px 0 8px;
  font-size:10px;
  font-weight:800;
  letter-spacing:.26em;
  color:#5e5e5e;
}

.oat-title{
  margin:0;
  font-family:"Space Grotesk",Arial,sans-serif;
  font-size:26px;
  line-height:1.1;
  font-weight:800;
  color:#111111;
}

.oat-subtitle{
  margin:12px 0 0;
  font-size:13px;
  line-height:1.7;
  color:#5e5e5e;
}

.oat-body{
  padding:6px 24px 24px;
}

.oat-grid{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:12px;
}

.oat-info{
  background:#f7f7f7;
  padding:14px;
  border-radius:18px;
  box-shadow:inset 0 0 0 1px rgba(32,26,23,0.05);
}

.oat-info-label{
  margin:0 0 7px;
  font-size:10px;
  font-weight:800;
  letter-spacing:.16em;
  color:#666666;
}

.oat-info-value{
  margin:0;
  font-size:13px;
  font-weight:800;
  color:#111111;
}

.oat-section{
  margin-top:18px;
}

.oat-section-title{
  margin:0 0 8px;
  font-size:10px;
  font-weight:800;
  letter-spacing:.2em;
  color:#111111;
}

.oat-card{
  background:#fafafa;
  padding:14px;
  border-radius:16px;
  box-shadow:inset 0 0 0 1px rgba(32,26,23,0.05);
}

.oat-name{
  margin:0;
  font-family:"Space Grotesk",Arial,sans-serif;
  font-size:16px;
  font-weight:800;
  color:#111111;
}

.oat-text{
  margin:10px 0 0;
  font-size:13px;
  line-height:1.8;
  color:#4a4a4a;
}

.oat-row{
  display:flex;
  justify-content:space-between;
  gap:16px;
  padding:7px 0;
  border-bottom:1px solid rgba(32,26,23,0.08);
  font-size:13px;
  color:#4a4a4a;
}

.oat-row:last-child{
  border-bottom:0;
}

.oat-row b{
  color:#111111;
}

.oat-divider{
  height:1px;
  background:rgba(32,26,23,0.12);
  margin:10px 0;
}

.oat-total{
  font-size:16px;
  font-weight:900;
  color:#111111;
}

.oat-btn-wrap{
  margin-top:18px;
  text-align:center;
}

.oat-btn{
  display:inline-block;
  background:#111111;
  color:#ffffff !important;
  text-decoration:none;
  padding:15px 26px;
  font-size:12px;
  font-weight:800;
  letter-spacing:.14em;
  border-radius:999px;
  box-shadow:0 12px 24px rgba(17,17,17,0.16);
}

.oat-note{
  margin:26px 0 0;
  font-size:11px;
  color:#666666;
  line-height:1.8;
}

.oat-footer{
  padding:20px 28px;
  background:#111111;
  color:#ffffff;
  text-align:center;
}

.oat-footer p{
  margin:0;
  font-size:10px;
  line-height:1.8;
  font-weight:700;
  letter-spacing:.16em;
  color:#ffffff;
}

@media only screen and (max-width:620px){
  .oat-bg{ padding:14px 8px; }

  .oat-header,
  .oat-body{
    padding-left:18px;
    padding-right:18px;
  }

  .oat-grid{ grid-template-columns:1fr; }

  .oat-title{ font-size:23px; }

  .oat-row{ display:block; }

  .oat-row b{
    display:block;
    margin-top:3px;
  }
}
</style>
</head>

<body>
<div class="oat-bg">
  <div class="oat-shell">

    <div class="oat-top">
      OATCLUB / ADMIN ORDER ALERT
    </div>

    <div class="oat-header">
      <h2 class="oat-logo-text">OATCLUB</h2>

      <p class="oat-kicker">NEW ORDER RECEIVED</p>
      <h1 class="oat-title">Order #${escapeHtml(orderId)}</h1>

      <p class="oat-subtitle">
        Final payable:
        <b>${escapeHtml(money(finalPayable, currency))}</b>
      </p>
    </div>

    <div class="oat-body">

      <div class="oat-grid">
        ${infoCard("Payment", paymentMethod)}
        ${infoCard("Status", fulfillmentStatus)}
        ${infoCard("Confirmed", isConfirmed)}
      </div>

      <div class="oat-section">
        <p class="oat-section-title">Customer</p>
        <div class="oat-card">
          <p class="oat-name">${escapeHtml(customerName)}</p>
          <p class="oat-text">
            Email: ${escapeHtml(customerEmail)}<br/>
            Phone: ${escapeHtml(customerPhone)}
          </p>
        </div>
      </div>

      <div class="oat-section">
        <p class="oat-section-title">Shipping Address</p>
        <div class="oat-card">
          <p class="oat-text">${escapeHtml(shippingAddress || "—")}</p>
        </div>
      </div>

      <div class="oat-section">
        <p class="oat-section-title">Items (${items.length} • Qty ${totalQty})</p>
        ${itemsHtml}
      </div>

      <div class="oat-section">
        <p class="oat-section-title">Pricing</p>
        <div class="oat-card">
          ${summaryRow("Subtotal", money(subtotal, currency))}
          ${summaryRow("Discount", `-${money(discount, currency)}`)}
          ${summaryRow("Shipping", money(shippingFee, currency))}
          ${summaryRow("Tax", money(tax, currency))}
          <div class="oat-divider"></div>
          ${summaryRowStrong("Final Payable", money(finalPayable, currency))}

          ${
            couponCode
              ? `<p class="oat-text">Coupon: <b>${escapeHtml(
                  couponCode
                )}</b> (-${escapeHtml(money(couponDiscount, currency))})</p>`
              : ""
          }
        </div>
      </div>

      <div class="oat-section">
        <p class="oat-section-title">Meta</p>
        <div class="oat-card">
          <p class="oat-text">
            Source: <b>${escapeHtml(source)}</b><br/>
            Priority: <b>${escapeHtml(priority)}</b><br/>
            Gift Order: <b>${escapeHtml(isGiftOrder)}</b><br/>
            Payment Ref: <b>${escapeHtml(paymentRef)}</b>
          </p>
        </div>
      </div>

      ${
        hasValidCta
          ? `
      <div class="oat-btn-wrap">
        <a href="${escapeAttr(ctaUrl)}" class="oat-btn">
          Open Order In Admin →
        </a>
      </div>`
          : ""
      }

      <p class="oat-note">
        This is an automated OATCLUB admin notification from oatclub.in.
      </p>
    </div>

    <div class="oat-footer">
      <p>OATCLUB • ADMIN NOTIFICATION • WEBSITE CHECKOUT • OATCLUB.IN</p>
    </div>

  </div>
</div>
</body>
</html>
`.trim();

  return { subject, text, html };
}

/* ---------------- HELPERS ---------------- */

function renderItemRow(it, currency) {
  const title = it?.productSnapshot?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);

  const attrs = extractVariantInfo(it);
  const img = getItemImage(it);

  return `
  <div class="oat-card" style="display:flex;gap:12px;margin-bottom:10px;align-items:flex-start;">
    ${
      img
        ? `
    <img
      src="${escapeAttr(img)}"
      alt="${escapeAttr(title)}"
      style="width:76px;height:92px;object-fit:cover;border-radius:16px;"
    />`
        : ""
    }

    <div style="flex:1;">
      <p class="oat-name" style="font-size:14px;">
        ${escapeHtml(title)}
      </p>

      ${
        attrs
          ? `<p class="oat-text" style="font-size:12px;">${escapeHtml(attrs)}</p>`
          : ""
      }

      <p class="oat-text">
        Qty: <b>${qty}</b> • Price: <b>${escapeHtml(money(price, currency))}</b>
      </p>
    </div>
  </div>`;
}

function infoCard(label, value) {
  return `
  <div class="oat-info">
    <p class="oat-info-label">${escapeHtml(label)}</p>
    <p class="oat-info-value">${escapeHtml(value)}</p>
  </div>`;
}

function emptyCard(msg) {
  return `
  <div class="oat-card">
    <p class="oat-text">${escapeHtml(msg)}</p>
  </div>`;
}

function summaryRow(label, value) {
  return `
  <div class="oat-row">
    <span>${escapeHtml(label)}</span>
    <b>${escapeHtml(value)}</b>
  </div>`;
}

function summaryRowStrong(label, value) {
  return `
  <div class="oat-row oat-total">
    <span>${escapeHtml(label)}</span>
    <b>${escapeHtml(value)}</b>
  </div>`;
}

function extractVariantInfo(it = {}) {
  const snap = it?.productSnapshot || {};
  const variant = it?.variant || {};
  const attrs = Array.isArray(variant?.attributes) ? variant.attributes : [];

  const size =
    it?.selectedSize ||
    attrs.find((a) => String(a?.key || "").toLowerCase() === "size")?.value ||
    "";

  const color =
    it?.selectedColor ||
    attrs.find((a) =>
      ["color", "colour"].includes(String(a?.key || "").toLowerCase())
    )?.value ||
    "";

  const sku = variant?.sku || snap?.sku || "";

  return [
    size && `Size: ${size}`,
    color && `Color: ${color}`,
    sku && `SKU: ${sku}`,
  ]
    .filter(Boolean)
    .join(" • ");
}

function getItemImage(it = {}) {
  const snap = it?.productSnapshot || {};
  const thumb = String(snap?.thumbnail || "").trim();

  const img0 = Array.isArray(snap?.images)
    ? String(snap.images[0] || "").trim()
    : "";

  return thumb || img0 || "";
}

function formatItemText(it, i, currency) {
  const title = it?.productSnapshot?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);
  const attrs = extractVariantInfo(it);

  return `${i}. ${title}${attrs ? ` (${attrs})` : ""} — Qty: ${qty} — ${money(
    price,
    currency
  )}`;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const money = (v, c) =>
  c === "INR" ? `₹${Number(v).toLocaleString("en-IN")}` : `${c} ${Number(v)}`;

const pretty = (s) =>
  String(s || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

function formatDate(d) {
  try {
    return new Date(d).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
      hour12: true,
    });
  } catch {
    return "";
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const escapeAttr = escapeHtml;
