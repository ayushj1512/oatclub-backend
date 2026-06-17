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
  background:#ffffff;
  color:#111111;
  font-family:Inter,Arial,sans-serif;
  text-transform:uppercase;
}

.oat-bg{
  padding:34px 14px;
  background:#ffffff;
}

.oat-shell{
  max-width:680px;
  margin:0 auto;
  background:#ffffff;
  border:1px solid #111111;
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
  padding:30px 26px 26px;
  text-align:center;
  border-bottom:1px solid #111111;
}

.oat-logo{
  width:112px;
  max-width:160px;
  height:auto;
  object-fit:contain;
}

.oat-kicker{
  margin:20px 0 8px;
  font-size:10px;
  font-weight:900;
  letter-spacing:.26em;
  color:#111111;
}

.oat-title{
  margin:0;
  font-size:28px;
  line-height:1.08;
  font-weight:900;
  letter-spacing:-.04em;
  color:#111111;
}

.oat-subtitle{
  margin:12px 0 0;
  font-size:13px;
  line-height:1.7;
  color:#555555;
}

.oat-body{
  padding:30px 26px 34px;
}

.oat-greeting{
  margin:0;
  font-size:24px;
  line-height:1.15;
  font-weight:900;
  letter-spacing:-.03em;
  color:#111111;
}

.oat-copy{
  margin:14px 0 0;
  font-size:14px;
  line-height:1.85;
  color:#444444;
}

.oat-section{
  margin-top:28px;
}

.oat-section-title{
  margin:0 0 12px;
  font-size:10px;
  font-weight:900;
  letter-spacing:.2em;
  color:#111111;
}

.oat-card{
  border:1px solid #111111;
  background:#ffffff;
  padding:18px;
}

.oat-row{
  display:flex;
  justify-content:space-between;
  gap:14px;
  padding:10px 0;
  border-bottom:1px solid #eeeeee;
  font-size:13px;
  line-height:1.7;
  color:#444444;
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
  margin-top:24px;
  text-align:center;
}

.oat-btn{
  display:inline-block;
  background:#111111;
  color:#ffffff !important;
  text-decoration:none;
  padding:15px 24px;
  font-size:11px;
  font-weight:900;
  letter-spacing:.16em;
}

.oat-note{
  margin:12px 0 0;
  font-size:11px;
  color:#666666;
  line-height:1.8;
}

.oat-note-card{
  margin-top:24px;
  border:1px solid #111111;
  background:#fafafa;
  padding:18px;
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

      <p class="oat-copy" style="margin-top:34px;">
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