// nodemailer/events/OrderCancellationEmailTemplate.js

export function orderCancellationTemplate({
  name = "Customer",
  order = {},
  ctaUrl = "#",
  reason = "",
}) {
  const orderId = order?.orderId || order?.orderNumber || order?._id || "—";
  const currency = order?.currency || "INR";

  const paymentMethod = up(order?.paymentMethod || "cod");
  const paymentStatus = up(order?.paymentStatus || "pending");
  const fulfillmentStatus = "CANCELLED";

  const subtotal = num(order?.subtotal);
  const discount = num(order?.discount);
  const shippingFee = num(order?.shippingFee);
  const tax = num(order?.tax);
  const finalPayable = num(order?.finalPayable);

  const couponCode = order?.coupon?.code ? String(order.coupon.code) : null;
  const items = Array.isArray(order?.items) ? order.items : [];

  const shipping = order?.shippingAddressSnapshot || {};

  const resolvedName =
    shipping?.fullName ||
    shipping?.name ||
    [shipping?.firstName, shipping?.lastName].filter(Boolean).join(" ") ||
    order?.customerId?.name ||
    order?.userSnapshot?.name ||
    name ||
    "Customer";

  const shippingName =
    shipping?.fullName ||
    shipping?.name ||
    [shipping?.firstName, shipping?.lastName].filter(Boolean).join(" ") ||
    resolvedName ||
    "Customer";

  const shippingPhone = shipping?.phone || shipping?.mobile || "";
  const shippingLine1 = shipping?.line1 || shipping?.address1 || "";
  const shippingLine2 = shipping?.line2 || shipping?.address2 || "";
  const shippingCity = shipping?.city || "";
  const shippingState = shipping?.state || "";
  const shippingZip = shipping?.pincode || shipping?.zip || "";
  const shippingCountry = shipping?.country || "India";

  const cancellationReason = reason ? String(reason).trim() : "";

  const apology =
    "We sincerely apologise for the inconvenience. We are working to ensure this does not happen again.";

  const refundLine =
    paymentMethod !== "COD"
      ? "If you already paid, the refund will be processed back to your original payment method as per bank timelines."
      : "As this was a Cash on Delivery order, no payment was collected.";

  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");

  const subject = `OATCLUB Order Cancelled — #${orderId}`;

  const text = `Hi ${resolvedName},

Your OATCLUB order has been cancelled.

Order ID: ${orderId}
Payment: ${paymentMethod} (${paymentStatus})
Status: ${fulfillmentStatus}

${apology}
${cancellationReason ? `Reason: ${cancellationReason}\n` : ""}
${refundLine}

Items:
${items.map((it, i) => formatItemText(it, i + 1, currency)).join("\n") || "—"}

Summary:
Subtotal: ${money(subtotal, currency)}
${discount > 0 ? `Discount: -${money(discount, currency)}\n` : ""}${
    couponCode ? `Coupon: ${couponCode}\n` : ""
  }Shipping: ${money(shippingFee, currency)}
Tax: ${money(tax, currency)}
Total: ${money(finalPayable, currency)}

Shipping Address:
${shippingName}
${[shippingLine1, shippingLine2].filter(Boolean).join(", ")}
${[shippingCity, shippingState, shippingZip].filter(Boolean).join(", ")}
${shippingCountry}${shippingPhone ? `\nPhone: ${shippingPhone}` : ""}

${hasValidCta ? `View Order: ${ctaUrl}\n` : ""}
With regards,
Team OATCLUB
`;

  const itemsHtml = items.length
    ? items.map((it) => renderItemCard(it, currency)).join("")
    : emptyCard("No items found.");

  const discountLabel = couponCode
    ? `Discount (${escapeHtml(couponCode)})`
    : "Discount";

  const html = `
<!doctype html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />

<style>
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap");

body{
  margin:0;
  padding:0;
  background:#f2f2f2;
  color:#111111;
  font-family:Inter,Arial,sans-serif;
  text-transform:uppercase;
}

.oat-bg{
  padding:24px 12px;
  background:#f2f2f2;
}

.oat-shell{
  max-width:680px;
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
  font-weight:900;
  letter-spacing:.24em;
}

.oat-header{
  padding:24px 24px 18px;
  text-align:center;
}

.oat-logo{
  width:112px;
  max-width:160px;
  height:auto;
  display:block;
  margin:0 auto;
  object-fit:contain;
}

.oat-kicker{
  margin:14px 0 6px;
  font-size:10px;
  font-weight:900;
  letter-spacing:.26em;
  color:#5e5e5e;
}

.oat-title{
  margin:0;
  font-size:24px;
  line-height:1.08;
  font-weight:900;
  letter-spacing:-.04em;
  color:#111111;
}

.oat-subtitle{
  margin:8px 0 0;
  font-size:13px;
  line-height:1.7;
  color:#5e5e5e;
}

.oat-body{
  padding:6px 24px 24px;
}

.oat-greeting{
  margin:0;
  font-size:20px;
  line-height:1.15;
  font-weight:900;
  letter-spacing:-.03em;
  color:#111111;
}

.oat-copy{
  margin:10px 0 0;
  font-size:14px;
  line-height:1.7;
  color:#4a4a4a;
}

.oat-alert{
  margin-top:22px;
  background:#f6f6f6;
  padding:14px;
  border-radius:16px;
  box-shadow:inset 0 0 0 1px rgba(32,26,23,0.04);
}

.oat-alert-title{
  margin:0 0 8px;
  font-size:10px;
  font-weight:900;
  letter-spacing:.18em;
  color:#5e5e5e;
}

.oat-section{
  margin-top:18px;
}

.oat-section-title{
  margin:0 0 8px;
  font-size:10px;
  font-weight:900;
  letter-spacing:.2em;
  color:#111111;
}

.oat-card{
  background:#fafafa;
  padding:14px;
  border-radius:16px;
  box-shadow:inset 0 0 0 1px rgba(32,26,23,0.05);
}

.oat-grid{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:12px;
  margin-top:18px;
}

.oat-info{
  background:#f7f7f7;
  padding:12px;
  border-radius:14px;
  box-shadow:inset 0 0 0 1px rgba(32,26,23,0.05);
}

.oat-info-label{
  margin:0 0 7px;
  font-size:10px;
  font-weight:900;
  letter-spacing:.16em;
  color:#666666;
}

.oat-info-value{
  margin:0;
  font-size:13px;
  font-weight:900;
  color:#111111;
}

.oat-item{
  display:flex;
  justify-content:space-between;
  gap:14px;
  background:#ffffff;
  padding:12px;
  margin-bottom:10px;
  border-radius:16px;
  box-shadow:inset 0 0 0 1px rgba(32,26,23,0.05);
}

.oat-item-title{
  margin:0 0 8px;
  font-size:14px;
  font-weight:900;
  color:#111111;
}

.oat-item-meta{
  margin:0;
  font-size:12px;
  color:#666666;
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
  padding:12px 20px;
  font-size:11px;
  font-weight:900;
  letter-spacing:.16em;
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
  padding:20px 26px;
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
  .oat-bg{
    padding:12px 7px;
  }

  .oat-header,
  .oat-body{
    padding-left:18px;
    padding-right:18px;
  }

  .oat-grid{
    grid-template-columns:1fr;
  }

  .oat-title{
    font-size:24px;
  }

  .oat-greeting{
    font-size:22px;
  }

  .oat-row{
    display:block;
  }

  .oat-row b{
    display:block;
    margin-top:3px;
  }

  .oat-item{
    display:block;
  }
}
</style>
</head>

<body>
<div class="oat-bg">
  <div class="oat-shell">

    <div class="oat-top">
      OATCLUB / ORDER UPDATE
    </div>

    <div class="oat-header">
      <img
        class="oat-logo"
        src="https://res.cloudinary.com/dpsvrt4sd/image/upload/v1780338447/qavpt44lsxsy3wrvuwi8.png"
        alt="OATCLUB"
      />

      <p class="oat-kicker">ORDER CANCELLED</p>
      <h1 class="oat-title">Order #${escapeHtml(orderId)}</h1>

      <p class="oat-subtitle">
        Status:
        <b>${escapeHtml(fulfillmentStatus)}</b>
      </p>
    </div>

    <div class="oat-body">

      <h2 class="oat-greeting">Hi ${escapeHtml(resolvedName)},</h2>

      <p class="oat-copy">
        We regret to inform you that your OATCLUB order has been cancelled.
      </p>

      <div class="oat-alert">
        <p class="oat-alert-title">IMPORTANT UPDATE</p>
        <p class="oat-copy" style="margin:0;">
          ${escapeHtml(apology)}
        </p>
      </div>

      ${
        cancellationReason
          ? `
      <div class="oat-section">
        <p class="oat-section-title">Cancellation Reason</p>
        <div class="oat-card">
          <p class="oat-copy" style="margin:0;">
            ${escapeHtml(cancellationReason)}
          </p>
        </div>
      </div>`
          : ""
      }

      <div class="oat-section">
        <p class="oat-section-title">Refund Info</p>
        <div class="oat-card">
          <p class="oat-copy" style="margin:0;">
            ${escapeHtml(refundLine)}
          </p>
        </div>
      </div>

      <div class="oat-grid">
        ${infoCard("Payment", paymentMethod)}
        ${infoCard("Status", fulfillmentStatus)}
        ${infoCard("Order Total", money(finalPayable, currency))}
      </div>

      <div class="oat-section">
        <p class="oat-section-title">Items</p>
        ${itemsHtml}
      </div>

      <div class="oat-section">
        <p class="oat-section-title">Summary</p>

        <div class="oat-card">
          ${summaryRow("Subtotal", money(subtotal, currency))}
          ${discount > 0 ? summaryRow(discountLabel, `- ${money(discount, currency)}`) : ""}
          ${couponCode ? summaryRow("Coupon", couponCode) : ""}
          ${summaryRow("Shipping", money(shippingFee, currency))}
          ${summaryRow("Tax", money(tax, currency))}
          <div class="oat-divider"></div>
          ${summaryRow("Order Total", money(finalPayable, currency), true)}

          <p class="oat-note" style="margin-top:12px;">
            Payment Method: ${escapeHtml(paymentMethod)}
          </p>
        </div>
      </div>

      <div class="oat-section">
        <p class="oat-section-title">Shipping Address</p>

        <div class="oat-card">
          <p class="oat-item-title">${escapeHtml(shippingName)}</p>
          <p class="oat-copy" style="margin:0;">
            ${escapeHtml([shippingLine1, shippingLine2].filter(Boolean).join(", ") || "—")}<br/>
            ${escapeHtml([shippingCity, shippingState, shippingZip].filter(Boolean).join(", ") || "—")}<br/>
            ${escapeHtml(shippingCountry)}
            ${shippingPhone ? `<br/>Phone: ${escapeHtml(shippingPhone)}` : ""}
          </p>
        </div>
      </div>

      ${
        hasValidCta
          ? `
      <div class="oat-btn-wrap">
        <a href="${escapeAttr(ctaUrl)}" class="oat-btn">
          View Order Details →
        </a>

        <p class="oat-note" style="margin-top:12px;">
          If you need assistance, reply to this email and we will help you.
        </p>
      </div>`
          : ""
      }

      <p class="oat-copy" style="margin-top:18px;">
        With regards,<br/>
        <b>Team OATCLUB</b>
      </p>

    </div>

    <div class="oat-footer">
      <p>OATCLUB • OWN ALL TRENDS •hey@oatclub.in</p>
    </div>

  </div>
</div>
</body>
</html>
`;

  return { subject, text, html };
}

/* ---------------- HELPERS ---------------- */

function renderItemCard(it, currency) {
  const snap = it?.productSnapshot || {};
  const title = snap?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);

  return `
  <div class="oat-item">
    <div style="flex:1;">
      <p class="oat-item-title">${escapeHtml(title)}</p>
      <p class="oat-item-meta">Qty: ${escapeHtml(qty)}</p>
    </div>

    <p class="oat-item-title" style="margin:0;">
      ${escapeHtml(money(price, currency))}
    </p>
  </div>`;
}

function formatItemText(it, i, currency) {
  const snap = it?.productSnapshot || {};
  const title = snap?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);

  return `${i}. ${title} — Qty: ${qty} — ${money(price, currency)}`;
}

function infoCard(label, value) {
  return `
  <div class="oat-info">
    <p class="oat-info-label">${escapeHtml(label)}</p>
    <p class="oat-info-value">${escapeHtml(value)}</p>
  </div>`;
}

function summaryRow(label, value, strong = false) {
  return `
  <div class="oat-row ${strong ? "oat-total" : ""}">
    <span>${escapeHtml(label)}</span>
    <b>${escapeHtml(value)}</b>
  </div>`;
}

function emptyCard(msg) {
  return `
  <div class="oat-card">
    <p class="oat-copy" style="margin:0;">${escapeHtml(msg)}</p>
  </div>`;
}

function up(s) {
  return String(s || "").toUpperCase();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(value, currency = "INR") {
  const n = num(value);
  return currency === "INR"
    ? `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
    : `${currency} ${n.toLocaleString()}`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}
