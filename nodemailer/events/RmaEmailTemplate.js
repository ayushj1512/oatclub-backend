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

  const subject = `RMA Request Received — ${type} | RMA#${rmaNumber} | Order #${orderNumber}`;

  const text = `Hi ${finalName},

Thank you — we’ve received your request and our team will assist you shortly.

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
Team Miray Fashions
`;

  const itemsHtml = items.length
    ? items.map((it) => renderRmaItemRow(it)).join("")
    : emptyCard("No items found.");

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
    RMA Request Received
  </p>

  <h1 style="margin:0;font-size:18px;letter-spacing:.14em;color:#ffffff;font-weight:700;">
    RMA# ${escapeHtml(rmaNumber)}
  </h1>

  <p style="margin:12px 0 0;font-size:13px;color:#e4e4e7;line-height:1.6;">
    Status <b style="color:#ffffff;">${escapeHtml(status)}</b>
  </p>
</div>

<div style="padding:36px 40px 44px;">

<h2 class="miray-title" style="margin:0 0 10px;font-size:24px;color:#111111;">
  Hi ${escapeHtml(finalName)} ✨
</h2>

<p class="miray-text" style="margin:0 0 26px;font-size:14px;line-height:1.8;color:#555555;">
  Thank you — we’ve received your request and our team will assist you shortly.
</p>

<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;">
  ${infoCard("Order", `#${orderNumber}`, "Delivered")}
  ${infoCard("Type", type, status)}
  ${
    type === "EXCHANGE"
      ? infoCard("Fee", money(feeAmount, feeCurrency), feeStatus)
      : infoCard("Window", `${windowDays} Days`, "Eligible")
  }
</div>

<div style="margin-top:30px;">
  <p class="miray-muted" style="${sectionTitleStyle}">Items in this request</p>
  ${itemsHtml}
</div>

<div style="margin-top:30px;">
  <p class="miray-muted" style="${sectionTitleStyle}">Reason</p>

  <div class="miray-card" style="${cardBoxStyle}">
    <p class="miray-title" style="margin:0;font-size:14px;font-weight:700;color:#111111;">
      ${escapeHtml(titleCase(reason))}
    </p>

    ${
      customerNote
        ? `
    <p class="miray-text" style="margin:10px 0 0;font-size:13px;line-height:1.8;color:#555555;">
      Customer Note: “${escapeHtml(customerNote)}”
    </p>`
        : ""
    }
  </div>
</div>

<div style="margin-top:30px;">
  <p class="miray-muted" style="${sectionTitleStyle}">What happens next?</p>

  <div class="miray-card" style="${cardBoxStyle}">
    <p class="miray-text" style="margin:0;font-size:13px;line-height:1.9;color:#555555;">
      • Our team will review your request within <b class="miray-strong">24 hours</b>.<br/>
      • If approved, we will schedule a pickup from your address.<br/>
      • You will receive updates on this email.
    </p>
  </div>
</div>

${
  hasValidCta
    ? `
<div style="margin-top:30px;text-align:center;">
  <a href="${escapeAttr(ctaUrl)}" class="miray-btn" style="display:inline-block;padding:15px 26px;border-radius:999px;background:#111111;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border:1px solid #111111;">
    View RMA Details
  </a>
  <p class="miray-muted" style="margin:12px 0 0;font-size:11px;color:#777777;">
    Tracking will be available once pickup is scheduled.
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

function infoCard(label, main, sub) {
  return `
  <div class="miray-card" style="padding:14px 16px;border-radius:16px;border:1px solid rgba(0,0,0,.08);background:#fcfcfc;">
    <p class="miray-muted" style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#777777;">
      ${escapeHtml(label)}
    </p>
    <p class="miray-title" style="margin:0;font-size:14px;font-weight:700;color:#111111;">
      ${escapeHtml(main)}
    </p>
    <p class="miray-muted" style="margin:6px 0 0;font-size:11px;color:#777777;">
      ${escapeHtml(sub)}
    </p>
  </div>`;
}

function renderRmaItemRow(it) {
  const title = it?.title || "Item";
  const code = it?.productCode ? `Product Code: ${it.productCode}` : "";
  const sku = it?.variantSku ? `Variant SKU: ${it.variantSku}` : "";
  const qty = num(it?.quantity);
  const meta = [code, sku].filter(Boolean).join(" • ");

  return `
  <div class="miray-card" style="padding:16px;border-radius:18px;border:1px solid rgba(0,0,0,.08);margin-bottom:14px;background:#ffffff;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
      <div style="flex:1;">
        <p class="miray-title" style="margin:0;font-size:14px;font-weight:700;color:#111111;">
          ${escapeHtml(title)}
        </p>

        ${
          meta
            ? `<p class="miray-muted" style="margin:8px 0 0;font-size:12px;color:#666666;">${escapeHtml(meta)}</p>`
            : ""
        }
      </div>

      <div style="text-align:right;">
        <p class="miray-muted" style="margin:0;font-size:12px;color:#666666;">Qty</p>
        <p class="miray-title" style="margin:4px 0 0;font-size:14px;font-weight:700;color:#111111;">
          ${escapeHtml(qty)}
        </p>
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
  <div class="miray-card miray-muted" style="padding:18px;border-radius:16px;border:1px dashed rgba(0,0,0,.12);color:#777777;background:#ffffff;">
    ${escapeHtml(msg)}
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
    .split(/[_\s-]+/)
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

const sectionTitleStyle =
  "margin:0 0 12px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#777777;";

const cardBoxStyle =
  "border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:18px;background:#fcfcfc;";