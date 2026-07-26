// nodemailer/events/RmaEmailTemplate.js

export function rmaCreatedTemplate({
  name = "Customer",
  order = {},
  rma = {},
  policy = { windowDays: 7 },
  ctaUrl = "#",
}) {
  const orderNumber = order?.orderNumber || order?.orderId || order?._id || "—";
  const rmaNumber = rma?.rmaNumber || "—";
  const type = String(rma?.type || "return").toUpperCase();
  const status = String(rma?.status || "requested").toUpperCase();
  const reason = String(rma?.reason || "other");
  const customerNote = String(rma?.customerNote || "");
  const windowDays = Number(policy?.windowDays || 7);

  const shipping = order?.shippingAddressSnapshot || {};
  const shippingName =
    shipping?.fullName ||
    shipping?.name ||
    [shipping?.firstName, shipping?.lastName].filter(Boolean).join(" ") ||
    "";

  const finalName = String(shippingName || name || "Customer").trim();

  const feeAmount = num(rma?.fee?.amount);
  const feeCurrency = String(rma?.fee?.currency || "INR");
  const feeStatus = String(
    rma?.fee?.status || (feeAmount > 0 ? "unpaid" : "waived")
  ).toUpperCase();

  const items = Array.isArray(rma?.items) ? rma.items : [];
  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");

  const subject = `OATCLUB RMA Request Received — ${type} | RMA#${rmaNumber}`;

  const text = `Hi ${finalName},

Thank you — we have received your OATCLUB ${type.toLowerCase()} request.

RMA Number: ${rmaNumber}
Order: ${orderNumber}
Type: ${type}
Status: ${status}
${type === "EXCHANGE" ? `Exchange Fee: ${money(feeAmount, feeCurrency)} (${feeStatus})\n` : ""}

Items:
${items.map((it, i) => formatRmaItemText(it, i + 1)).join("\n") || "—"}

Reason: ${reason}
${customerNote ? `Customer Note: ${customerNote}\n` : ""}

What happens next?
- Our team will review your request within 24 hours.
- If approved, we will schedule a pickup from your address.
- You will receive updates on this email.

${hasValidCta ? `View RMA Details: ${ctaUrl}\n` : ""}
With regards,
Team OATCLUB
`;

  const itemsHtml = items.length
    ? items.map((it) => renderRmaItemRow(it)).join("")
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

.oat-info-sub{
  margin:6px 0 0;
  font-size:11px;
  color:#666666;
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

.oat-item{
  background:#ffffff;
  padding:12px;
  margin-bottom:10px;
  border-radius:16px;
  box-shadow:inset 0 0 0 1px rgba(32,26,23,0.05);
}

.oat-item-inner{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
}

.oat-item-title{
  margin:0;
  font-size:14px;
  font-weight:900;
  color:#111111;
}

.oat-item-meta{
  margin:8px 0 0;
  font-size:12px;
  color:#666666;
  line-height:1.6;
}

.oat-qty{
  text-align:right;
}

.oat-qty-label{
  margin:0;
  font-size:12px;
  color:#666666;
}

.oat-qty-value{
  margin:4px 0 0;
  font-size:14px;
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
  margin:12px 0 0;
  font-size:11px;
  color:#666666;
  line-height:1.8;
}

.oat-note-card{
  background:#f6f6f6;
  padding:14px;
  border-radius:16px;
  box-shadow:inset 0 0 0 1px rgba(32,26,23,0.04);
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

  .oat-item-inner{
    display:block;
  }

  .oat-qty{
    text-align:left;
    margin-top:12px;
  }
}
</style>
</head>

<body>
<div class="oat-bg">
  <div class="oat-shell">

    <div class="oat-top">
      OATCLUB / RETURN & EXCHANGE
    </div>

    <div class="oat-header">
      <img
        class="oat-logo"
        src="https://res.cloudinary.com/dpsvrt4sd/image/upload/v1780338447/qavpt44lsxsy3wrvuwi8.png"
        alt="OATCLUB"
      />

      <p class="oat-kicker">RMA REQUEST RECEIVED</p>
      <h1 class="oat-title">RMA# ${escapeHtml(rmaNumber)}</h1>

      <p class="oat-subtitle">
        Status:
        <b>${escapeHtml(status)}</b>
      </p>
    </div>

    <div class="oat-body">

      <h2 class="oat-greeting">Hi ${escapeHtml(finalName)},</h2>

      <p class="oat-copy">
        Thank you — we have received your OATCLUB ${escapeHtml(type.toLowerCase())} request and our team will assist you shortly.
      </p>

      <div class="oat-grid">
        ${infoCard("Order", `#${orderNumber}`, "Delivered")}
        ${infoCard("Type", type, status)}
        ${
          type === "EXCHANGE"
            ? infoCard("Fee", money(feeAmount, feeCurrency), feeStatus)
            : infoCard("Window", `${windowDays} Days`, "Eligible")
        }
      </div>

      <div class="oat-section">
        <p class="oat-section-title">Items In This Request</p>
        ${itemsHtml}
      </div>

      <div class="oat-section">
        <p class="oat-section-title">Reason</p>

        <div class="oat-card">
          <p class="oat-item-title">${escapeHtml(titleCase(reason))}</p>

          ${
            customerNote
              ? `
          <p class="oat-copy">
            Customer Note: “${escapeHtml(customerNote)}”
          </p>`
              : ""
          }
        </div>
      </div>

      <div class="oat-section">
        <p class="oat-section-title">What Happens Next?</p>

        <div class="oat-note-card">
          <p class="oat-copy" style="margin:0;">
            • Our team will review your request within <b>24 hours</b>.<br/>
            • If approved, we will schedule a pickup from your address.<br/>
            • You will receive updates on this email.
          </p>
        </div>
      </div>

      ${
        hasValidCta
          ? `
      <div class="oat-btn-wrap">
        <a href="${escapeAttr(ctaUrl)}" class="oat-btn">
          View RMA Details →
        </a>

        <p class="oat-note">
          Tracking will be available once pickup is scheduled.
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

function infoCard(label, main, sub) {
  return `
  <div class="oat-info">
    <p class="oat-info-label">${escapeHtml(label)}</p>
    <p class="oat-info-value">${escapeHtml(main)}</p>
    <p class="oat-info-sub">${escapeHtml(sub)}</p>
  </div>`;
}

function renderRmaItemRow(it) {
  const title = it?.title || "Item";
  const code = it?.productCode ? `Product Code: ${it.productCode}` : "";
  const sku = it?.variantSku ? `Variant SKU: ${it.variantSku}` : "";
  const qty = num(it?.quantity);
  const meta = [code, sku].filter(Boolean).join(" • ");

  return `
  <div class="oat-item">
    <div class="oat-item-inner">
      <div style="flex:1;">
        <p class="oat-item-title">${escapeHtml(title)}</p>

        ${
          meta
            ? `<p class="oat-item-meta">${escapeHtml(meta)}</p>`
            : ""
        }
      </div>

      <div class="oat-qty">
        <p class="oat-qty-label">Qty</p>
        <p class="oat-qty-value">${escapeHtml(qty)}</p>
      </div>
    </div>
  </div>`;
}

function formatRmaItemText(it, idx) {
  const title = it?.title || "Item";
  const qty = num(it?.quantity);
  const code = it?.productCode ? `Code: ${it.productCode}` : "";
  const sku = it?.variantSku ? `SKU: ${it.variantSku}` : "";
  const meta = [code, sku].filter(Boolean).join(" | ");

  return `${idx}. ${title} — Qty: ${qty}${meta ? ` — ${meta}` : ""}`;
}

function emptyCard(msg) {
  return `
  <div class="oat-card">
    <p class="oat-copy" style="margin:0;">${escapeHtml(msg)}</p>
  </div>`;
}

function money(value, currency = "INR") {
  const n = num(value);
  return currency === "INR"
    ? `₹${formatNumber(n)}`
    : `${currency} ${formatNumber(n)}`;
}

function formatNumber(n) {
  try {
    return Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  } catch {
    return String(n);
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function titleCase(s) {
  return String(s || "")
    .split(/[_\\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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
