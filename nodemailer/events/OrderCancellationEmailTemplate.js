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

  const subject = `Order Cancelled — #${orderId}`;

  const text = `Hi ${resolvedName},

Your order has been cancelled.

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
Team Miray Fashions
`;

  const itemsHtml = items.length
    ? items.map((it) => renderItemCard(it, currency)).join("")
    : emptyCard("No items found.");

  const discountLabel = couponCode
    ? `Discount (${escapeHtml(couponCode)})`
    : "Discount";

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />

<style>
:root{
  color-scheme:light dark;
  supported-color-schemes:light dark;
}

@media (prefers-color-scheme: dark){
  body,.miray-bg{background:#0f0f10!important;}
  .miray-shell{background:#151517!important;border-color:rgba(255,255,255,.08)!important;}
  .miray-card{background:#1b1b1d!important;border-color:rgba(255,255,255,.08)!important;}
  .miray-text{color:#e4e4e7!important;}
  .miray-muted{color:#b4b4b8!important;}
  .miray-title,.miray-strong{color:#ffffff!important;}
  .miray-divider{background:rgba(255,255,255,.08)!important;}
  .miray-btn{background:#ffffff!important;color:#111111!important;border-color:#ffffff!important;}
  .miray-header{background:linear-gradient(180deg,#18181b 0%,#0f0f10 100%)!important;}
  .miray-header p,.miray-header span,.miray-header div{color:#e4e4e7!important;}
  .miray-header h1,.miray-header b{color:#ffffff!important;}
  .miray-footer{border-color:rgba(255,255,255,.08)!important;}
}

[data-ogsc] .miray-bg{background:#0f0f10!important;}
[data-ogsc] .miray-shell{background:#151517!important;}
[data-ogsc] .miray-card{background:#1b1b1d!important;}
[data-ogsc] .miray-text{color:#e4e4e7!important;}
[data-ogsc] .miray-muted{color:#b4b4b8!important;}
[data-ogsc] .miray-title,[data-ogsc] .miray-strong{color:#ffffff!important;}
[data-ogsc] .miray-header{background:linear-gradient(180deg,#18181b 0%,#0f0f10 100%)!important;}
[data-ogsc] .miray-header p,[data-ogsc] .miray-header span,[data-ogsc] .miray-header div{color:#e4e4e7!important;}
[data-ogsc] .miray-header h1,[data-ogsc] .miray-header b{color:#ffffff!important;}
[data-ogsc] .miray-footer{border-color:rgba(255,255,255,.08)!important;}
</style>
</head>

<body style="margin:0;padding:0;background:#ffffff;">
<div class="miray-bg" style="padding:40px 20px;background:#ffffff;">

<div class="miray-shell" style="max-width:680px;margin:auto;background:#ffffff;border:1px solid rgba(0,0,0,.08);border-radius:28px;overflow:hidden;font-family:Poppins,Arial,sans-serif;">

<div class="miray-header" style="padding:48px 40px 30px;text-align:center;background:linear-gradient(180deg,#18181b 0%,#0f0f10 100%);">
  <img
    src="https://res.cloudinary.com/djtva6hec/image/upload/v1778268933/miray/media/zvliktr4z5zboetdz76k.png"
    alt="Miray Fashions"
    style="height:56px;max-width:100%;"
  />

  <p style="margin:24px 0 8px;font-size:11px;letter-spacing:.42em;text-transform:uppercase;color:#d4d4d8;">
    Order Cancelled
  </p>

  <h1 style="margin:0;font-size:18px;letter-spacing:.18em;color:#ffffff;font-weight:700;">
    #${escapeHtml(orderId)}
  </h1>

  <p style="margin:12px 0 0;font-size:13px;color:#e4e4e7;line-height:1.6;">
    Status <b style="color:#ffffff;">Cancelled</b>
  </p>
</div>

<div style="padding:36px 40px 44px;">

<h2 class="miray-title" style="margin:0 0 10px;font-size:24px;color:#111111;">
  Hi ${escapeHtml(resolvedName)}
</h2>

<p class="miray-text" style="margin:0 0 12px;font-size:14px;line-height:1.8;color:#555555;">
  We regret to inform you that your order has been cancelled.
</p>

<p class="miray-text" style="margin:0 0 26px;font-size:13px;line-height:1.8;color:#666666;">
  ${escapeHtml(apology)}
</p>

${
  cancellationReason
    ? `
<div class="miray-card" style="${cardBoxStyle};margin-bottom:14px;">
  <p class="miray-muted" style="${sectionTitleStyle}">Cancellation Reason</p>
  <p class="miray-text" style="margin:0;font-size:13px;line-height:1.8;color:#555555;">
    ${escapeHtml(cancellationReason)}
  </p>
</div>`
    : ""
}

<div class="miray-card" style="${cardBoxStyle};margin-bottom:26px;">
  <p class="miray-muted" style="${sectionTitleStyle}">Refund Info</p>
  <p class="miray-text" style="margin:0;font-size:13px;line-height:1.8;color:#555555;">
    ${escapeHtml(refundLine)}
  </p>
</div>

<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;">
  ${infoCard("Payment", paymentMethod)}
  ${infoCard("Status", fulfillmentStatus)}
  ${infoCard("Order Total", money(finalPayable, currency))}
</div>

<div style="margin-top:30px;">
  <p class="miray-muted" style="${sectionTitleStyle}">Items</p>
  ${itemsHtml}
</div>

<div style="margin-top:30px;">
  <p class="miray-muted" style="${sectionTitleStyle}">Summary</p>

  <div class="miray-card" style="${cardBoxStyle}">
    ${summaryRow("Subtotal", money(subtotal, currency))}
    ${discount > 0 ? summaryRow(discountLabel, `- ${money(discount, currency)}`) : ""}
    ${couponCode ? summaryRow("Coupon", couponCode) : ""}
    ${summaryRow("Shipping", money(shippingFee, currency))}
    ${summaryRow("Tax", money(tax, currency))}
    <div class="miray-divider" style="height:1px;background:rgba(0,0,0,.08);margin:14px 0;"></div>
    ${summaryRow("Order Total", money(finalPayable, currency), true)}
    <p class="miray-muted" style="margin:12px 0 0;font-size:11px;color:#777777;">
      Payment Method: ${escapeHtml(paymentMethod)}
    </p>
  </div>
</div>

<div style="margin-top:30px;">
  <p class="miray-muted" style="${sectionTitleStyle}">Shipping Address</p>

  <div class="miray-card" style="${cardBoxStyle}">
    <p class="miray-title" style="margin:0 0 6px;font-size:14px;font-weight:600;color:#111111;">
      ${escapeHtml(shippingName)}
    </p>
    <p class="miray-text" style="margin:0;font-size:13px;line-height:1.8;color:#555555;">
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
<div style="margin-top:30px;text-align:center;">
  <a href="${escapeAttr(ctaUrl)}" class="miray-btn" style="display:inline-block;padding:15px 26px;border-radius:999px;background:#111111;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border:1px solid #111111;">
    View Order Details
  </a>
  <p class="miray-muted" style="margin:12px 0 0;font-size:11px;color:#777777;">
    If you need assistance, reply to this email and we will help you.
  </p>
</div>`
    : ""
}

<p class="miray-text" style="margin-top:34px;font-size:14px;line-height:1.8;color:#444444;">
  With regards,<br />
  <b class="miray-strong">Team Miray Fashions</b>
</p>

</div>

<div class="miray-footer" style="padding:24px 40px;border-top:1px solid rgba(0,0,0,.08);">
  <p class="miray-muted" style="margin:0;font-size:11px;line-height:1.8;color:#777777;">
    This is an automated message. You can reply to this email for any assistance.
  </p>
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
  <div class="miray-card" style="display:flex;justify-content:space-between;gap:14px;padding:16px;border-radius:18px;border:1px solid rgba(0,0,0,.08);margin-bottom:14px;background:#ffffff;">
    <div style="flex:1;">
      <p class="miray-title" style="margin:0 0 8px;font-size:14px;font-weight:600;color:#111111;">
        ${escapeHtml(title)}
      </p>
      <p class="miray-muted" style="margin:0;font-size:12px;color:#666666;">
        Qty: ${escapeHtml(qty)}
      </p>
    </div>

    <p class="miray-title" style="margin:0;font-size:13px;font-weight:600;color:#111111;">
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
  <div class="miray-card" style="padding:14px 16px;border-radius:16px;border:1px solid rgba(0,0,0,.08);background:#fcfcfc;">
    <p class="miray-muted" style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#777777;">
      ${escapeHtml(label)}
    </p>
    <p class="miray-title" style="margin:0;font-size:14px;font-weight:600;color:#111111;">
      ${escapeHtml(value)}
    </p>
  </div>`;
}

function summaryRow(label, value, strong = false) {
  return `
  <div class="miray-text" style="display:flex;justify-content:space-between;margin:10px 0;font-size:${strong ? "15px" : "13px"};color:#444444;">
    <span ${strong ? 'class="miray-strong" style="font-weight:700;color:#111111;"' : ""}>
      ${escapeHtml(label)}
    </span>
    <span ${strong ? 'class="miray-strong" style="font-weight:700;color:#111111;"' : ""}>
      ${escapeHtml(value)}
    </span>
  </div>`;
}

function emptyCard(msg) {
  return `
  <div class="miray-card miray-muted" style="padding:18px;border-radius:16px;border:1px dashed rgba(0,0,0,.12);color:#777777;background:#ffffff;">
    ${escapeHtml(msg)}
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

const sectionTitleStyle =
  "margin:0 0 12px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#777777;";

const cardBoxStyle =
  "border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:18px;background:#fcfcfc;";