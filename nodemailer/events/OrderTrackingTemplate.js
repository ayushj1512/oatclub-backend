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

  const subject = `OATCLUB Order Tracking — #${orderId}`;

  const text = `Hi ${name},

Your OATCLUB shipment is now in transit.

Order ID: ${orderId}
Courier: ${courierName}
AWB: ${awb}
${hasValidLink ? `Track Here: ${trackingLink}` : ""}

With regards,
Team OATCLUB
`;

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

.oat-row{
  display:flex;
  justify-content:space-between;
  gap:14px;
  padding:7px 0;
  border-bottom:1px solid rgba(32,26,23,0.08);
  font-size:13px;
  line-height:1.7;
  color:#4a4a4a;
}

.oat-row:last-child{
  border-bottom:0;
}

.oat-row-label{
  min-width:120px;
  color:#666666;
  font-weight:700;
}

.oat-row-value{
  text-align:right;
  font-weight:900;
  color:#111111;
  word-break:break-word;
}

.oat-link{
  color:#111111 !important;
  text-decoration:underline;
  font-weight:900;
  text-align:right;
  word-break:break-word;
}

.oat-btn-wrap{
  margin-top:16px;
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
  margin-top:16px;
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

  .oat-title{
    font-size:24px;
  }

  .oat-greeting{
    font-size:22px;
  }

  .oat-row{
    display:block;
  }

  .oat-row-value,
  .oat-link{
    display:block;
    text-align:left;
    margin-top:4px;
  }
}
</style>
</head>

<body>
<div class="oat-bg">
  <div class="oat-shell">

    <div class="oat-top">
      OATCLUB / TRACKING UPDATE
    </div>

    <div class="oat-header">
      <img
        class="oat-logo"
        src="https://res.cloudinary.com/dpsvrt4sd/image/upload/v1780338447/qavpt44lsxsy3wrvuwi8.png"
        alt="OATCLUB"
      />

      <p class="oat-kicker">ORDER TRACKING</p>
      <h1 class="oat-title">Order #${escapeHtml(orderId)}</h1>

      <p class="oat-subtitle">
        Shipment:
        <b>In Transit</b>
      </p>
    </div>

    <div class="oat-body">

      <h2 class="oat-greeting">Hi ${escapeHtml(name)},</h2>

      <p class="oat-copy">
        Your OATCLUB order is on the way. You can track it anytime using the details below.
      </p>

      <div class="oat-section">
        <p class="oat-section-title">Tracking Details</p>

        <div class="oat-card">
          ${infoRow("Courier", courierName)}
          ${infoRow("AWB", awb)}
          ${
            hasValidLink
              ? infoRowLink("Tracking Link", trackingLink)
              : infoRow("Tracking Link", "Will Be Available Soon")
          }

          ${
            hasValidLink
              ? `
          <div class="oat-btn-wrap">
            <a href="${escapeAttr(trackingLink)}" class="oat-btn">
              Track Your Order →
            </a>

            <p class="oat-note">
              If the button does not work, copy and open the tracking link above.
            </p>
          </div>`
              : ""
          }
        </div>
      </div>

      <div class="oat-note-card">
        <p class="oat-copy" style="margin:0;">
          Updates may take a few hours to reflect on the courier tracking page after dispatch.
        </p>
      </div>

      <p class="oat-copy" style="margin-top:18px;">
        With regards,<br/>
        <b>Team OATCLUB</b>
      </p>

    </div>

    <div class="oat-footer">
      <p>OATCLUB • OWN ALL TRENDS • SUPPORT@OATCLUB.IN</p>
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
  <div class="oat-row">
    <span class="oat-row-label">${escapeHtml(label)}</span>
    <span class="oat-row-value">${escapeHtml(value)}</span>
  </div>`;
}

function infoRowLink(label, link) {
  return `
  <div class="oat-row">
    <span class="oat-row-label">${escapeHtml(label)}</span>
    <a href="${escapeAttr(link)}" class="oat-link">
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
