// nodemailer/events/OrderShippedTemplate.js

export function orderShippedTemplate({
  name = "Customer",
  order = {},
  ctaUrl = "#",
}) {
  const orderId = order?.orderId || order?.orderNumber || order?._id || "—";
  const currency = order?.currency || "INR";

  const shippedAt = order?.shipment?.shippedAt || new Date();
  const expectedDelivery = order?.trackingDetails?.expectedDelivery || null;

  const awb = order?.shipment?.shiprocket?.awb || "";
  const courierName = order?.shipment?.shiprocket?.courierName || "";
  const trackingLink = order?.shipment?.shiprocket?.trackingUrl || "";

  const hasAwb = Boolean(String(awb).trim());
  const hasCourier = Boolean(String(courierName).trim());
  const hasShippingMeta = hasAwb && hasCourier;

  const hasTracking = Boolean(String(trackingLink).trim());
  const hasExpectedDelivery = Boolean(expectedDelivery);
  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");

  const items = Array.isArray(order?.items) ? order.items : [];
  const itemsHtml = items.length
    ? items.map((it) => renderItemCard(it, currency)).join("")
    : "";

  const subject = `OATCLUB Order Shipped — #${orderId}`;

  const text = [
    `Hi ${name},`,
    ``,
    `Your OATCLUB order has been shipped and is on the way.`,
    ``,
    `Order ID: ${orderId}`,
    `Shipped On: ${formatDate(shippedAt)}`,
    hasShippingMeta ? `Courier: ${courierName}` : "",
    hasShippingMeta ? `AWB / Tracking ID: ${awb}` : "",
    hasExpectedDelivery ? `Expected Delivery: ${formatDate(expectedDelivery)}` : "",
    hasTracking ? `Track Shipment: ${trackingLink}` : "",
    hasValidCta ? `View Order: ${ctaUrl}` : "",
    ``,
    `With regards,`,
    `Team OATCLUB`,
  ]
    .filter(Boolean)
    .join("\n");

  const shipmentBoxes = [
    infoBox("Order ID", orderId),
    hasShippingMeta ? infoBox("Courier", courierName) : "",
    hasShippingMeta ? infoBox("AWB / Tracking ID", awb) : "",
    hasExpectedDelivery
      ? infoBox("Expected Delivery", formatDate(expectedDelivery))
      : "",
  ]
    .filter(Boolean)
    .join("");

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

.oat-shipment-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
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
  word-break:break-word;
}

.oat-item{
  display:flex;
  gap:14px;
  background:#ffffff;
  padding:12px;
  margin-bottom:10px;
  border-radius:16px;
  box-shadow:inset 0 0 0 1px rgba(32,26,23,0.05);
}

.oat-thumb{
  width:72px;
  height:88px;
  object-fit:cover;
  border-radius:16px;
}

.oat-item-content{
  flex:1;
}

.oat-item-title{
  margin:0 0 8px;
  font-size:14px;
  font-weight:900;
  color:#111111;
}

.oat-item-meta{
  margin:0 0 10px;
  font-size:12px;
  color:#666666;
  line-height:1.6;
}

.oat-item-bottom{
  display:flex;
  justify-content:space-between;
  gap:12px;
  font-size:13px;
  color:#4a4a4a;
}

.oat-item-bottom b{
  color:#111111;
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

.oat-btn-secondary{
  display:inline-block;
  background:#f2f2f2;
  color:#111111 !important;
  text-decoration:none;
  padding:12px 18px;
  font-size:11px;
  font-weight:900;
  letter-spacing:.16em;
  border-radius:999px;
  box-shadow:inset 0 0 0 1px rgba(17,17,17,0.08);
}

.oat-note-card{
  margin-top:18px;
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

  .oat-shipment-grid{
    grid-template-columns:1fr;
  }

  .oat-title{
    font-size:24px;
  }

  .oat-greeting{
    font-size:22px;
  }

  .oat-item{
    display:block;
  }

  .oat-thumb{
    width:100%;
    height:auto;
    max-height:220px;
    margin-bottom:12px;
  }

  .oat-item-bottom{
    display:block;
  }

  .oat-item-bottom b{
    display:block;
    margin-top:4px;
  }
}
</style>
</head>

<body>
<div class="oat-bg">
  <div class="oat-shell">

    <div class="oat-top">
      OATCLUB / SHIPPING UPDATE
    </div>

    <div class="oat-header">
      <img
        class="oat-logo"
        src="https://res.cloudinary.com/dpsvrt4sd/image/upload/v1780338447/qavpt44lsxsy3wrvuwi8.png"
        alt="OATCLUB"
      />

      <p class="oat-kicker">ORDER SHIPPED</p>
      <h1 class="oat-title">Order #${escapeHtml(orderId)}</h1>

      <p class="oat-subtitle">
        Shipped On:
        <b>${escapeHtml(formatDate(shippedAt))}</b>
      </p>
    </div>

    <div class="oat-body">

      <h2 class="oat-greeting">Hi ${escapeHtml(name)},</h2>

      <p class="oat-copy">
        Your OATCLUB order is on the way. You can find your shipment details below.
      </p>

      <div class="oat-section">
        <p class="oat-section-title">Shipment Details</p>

        <div class="oat-card">
          <div class="oat-shipment-grid">
            ${shipmentBoxes}
          </div>

          ${
            hasTracking
              ? `
          <div class="oat-btn-wrap">
            <a href="${escapeAttr(trackingLink)}" class="oat-btn">
              Track Shipment →
            </a>
          </div>`
              : ""
          }
        </div>
      </div>

      ${
        itemsHtml
          ? `
      <div class="oat-section">
        <p class="oat-section-title">Items</p>
        ${itemsHtml}
      </div>`
          : ""
      }

      ${
        hasValidCta
          ? `
      <div class="oat-btn-wrap" style="margin-top:18px;">
        <a href="${escapeAttr(ctaUrl)}" class="oat-btn-secondary">
          View Order →
        </a>
      </div>`
          : ""
      }

      <div class="oat-note-card">
        <p class="oat-copy" style="margin:0;">
          We will keep you updated on the next delivery milestone.
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

function renderItemCard(it, currency) {
  const snap = it?.productSnapshot || {};
  const title = snap?.title || "Item";
  const qty = Number(it?.quantity || 0);
  const price = Number(it?.price || 0);

  const thumb =
    snap?.thumbnail ||
    (Array.isArray(snap?.images) ? snap.images[0] : "") ||
    "";

  const meta = getItemMeta(it);

  return `
  <div class="oat-item">
    ${
      thumb
        ? `<img class="oat-thumb" src="${escapeAttr(thumb)}" alt="${escapeAttr(title)}" />`
        : ""
    }

    <div class="oat-item-content">
      <p class="oat-item-title">${escapeHtml(title)}</p>

      ${meta ? `<p class="oat-item-meta">${escapeHtml(meta)}</p>` : ""}

      <div class="oat-item-bottom">
        <span>Qty: ${escapeHtml(qty)}</span>
        <b>${escapeHtml(money(price, currency))}</b>
      </div>
    </div>
  </div>`;
}

function getItemMeta(it = {}) {
  const attrs = Array.isArray(it?.variant?.attributes)
    ? it.variant.attributes
    : [];

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

  const sku = it?.variant?.sku || it?.productSnapshot?.sku || "";

  return [
    size ? `Size: ${size}` : "",
    color ? `Color: ${color}` : "",
    sku ? `SKU: ${sku}` : "",
  ]
    .filter(Boolean)
    .join(" • ");
}

function infoBox(label, value) {
  return `
  <div class="oat-info">
    <p class="oat-info-label">${escapeHtml(label)}</p>
    <p class="oat-info-value">${escapeHtml(value)}</p>
  </div>`;
}

function formatDate(date) {
  try {
    return new Date(date).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "Recently";
  }
}

const money = (v, c) =>
  c === "INR"
    ? `₹${Number(v || 0).toLocaleString("en-IN")}`
    : `${c} ${Number(v || 0).toLocaleString()}`;

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m]));

const escapeAttr = escapeHtml;
