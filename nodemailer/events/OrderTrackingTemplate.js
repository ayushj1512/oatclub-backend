// nodemailer/events/OrderTrackingTemplate.js

export function orderTrackingTemplate({
  name = "Customer",
  awb = "—",
  courierName = "—",
  trackingLink = "#",
  order = {},
}) {
  const orderId = order?.orderId || order?.orderNumber || order?._id || "—";
  const hasValidLink = Boolean(trackingLink && trackingLink !== "#");

  const subject = `Your order is on the way — Tracking details #${orderId} 📦`;

  const text = `Hi ${name},

Your shipment is now in transit. Here are your tracking details:

Order ID: ${orderId}
Courier: ${courierName}
AWB: ${awb}
${hasValidLink ? `Track Here: ${trackingLink}` : ""}

With regards,
Team Miray Fashions
`;

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
  .miray-link{color:#ffffff!important;}
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
[data-ogsc] .miray-link{color:#ffffff!important;}
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
    Order Tracking
  </p>

  <h1 style="margin:0;font-size:18px;letter-spacing:.18em;color:#ffffff;font-weight:700;">
    #${escapeHtml(orderId)}
  </h1>

  <p style="margin:12px 0 0;font-size:13px;color:#e4e4e7;line-height:1.6;">
    Shipment <b style="color:#ffffff;">In Transit</b>
  </p>
</div>

<div style="padding:36px 40px 44px;">

<h2 class="miray-title" style="margin:0 0 10px;font-size:24px;color:#111111;">
  Hi ${escapeHtml(name)} ✨
</h2>

<p class="miray-text" style="margin:0 0 26px;font-size:14px;line-height:1.8;color:#555555;">
  Your order is on the way. You can track it anytime using the details below.
</p>

<div class="miray-card" style="${cardBoxStyle}">
  <p class="miray-muted" style="${sectionTitleStyle}">Tracking Details</p>

  <div style="margin-top:14px;">
    ${infoRow("Courier", courierName)}
    ${infoRow("AWB", awb)}
    ${
      hasValidLink
        ? infoRowLink("Tracking Link", trackingLink)
        : infoRow("Tracking Link", "Will be available soon")
    }
  </div>

  ${
    hasValidLink
      ? `
  <div style="margin-top:22px;text-align:center;">
    <a href="${escapeAttr(trackingLink)}" class="miray-btn" style="display:inline-block;padding:15px 26px;border-radius:999px;background:#111111;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border:1px solid #111111;">
      Track Your Order
    </a>
    <p class="miray-muted" style="margin:12px 0 0;font-size:11px;color:#777777;">
      If the button doesn’t work, copy and open the tracking link above.
    </p>
  </div>`
      : ""
  }
</div>

<div class="miray-card" style="margin-top:24px;padding:18px;border-radius:18px;background:#faf7f8;border:1px solid rgba(0,0,0,.05);">
  <p class="miray-text" style="margin:0;font-size:13px;line-height:1.8;color:#555555;">
    Updates may take a few hours to reflect on the courier tracking page after dispatch.
  </p>
</div>

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

function infoRow(label, value) {
  return `
  <div class="miray-text" style="display:flex;justify-content:space-between;gap:14px;margin:0 0 12px;font-size:13px;line-height:1.8;color:#444444;">
    <span style="min-width:120px;">${escapeHtml(label)}</span>
    <span class="miray-strong" style="font-weight:700;color:#111111;word-break:break-word;text-align:right;">
      ${escapeHtml(value)}
    </span>
  </div>`;
}

function infoRowLink(label, link) {
  return `
  <div class="miray-text" style="display:flex;justify-content:space-between;gap:14px;margin:0 0 12px;font-size:13px;line-height:1.8;color:#444444;">
    <span style="min-width:120px;">${escapeHtml(label)}</span>
    <a href="${escapeAttr(link)}" class="miray-link" style="font-weight:700;color:#111111;text-decoration:underline;word-break:break-word;text-align:right;">
      ${escapeHtml(link)}
    </a>
  </div>`;
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