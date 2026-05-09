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

  const subject = `Order Shipped — #${orderId} 🚚`;

  const text = [
    `Hi ${name},`,
    ``,
    `Your order has been shipped and is on the way.`,
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
    `Team Miray Fashions`,
  ]
    .filter(Boolean)
    .join("\n");

  const shipmentBoxes = [
    infoBox("Order ID", orderId),
    hasShippingMeta ? infoBox("Courier", courierName) : "",
    hasShippingMeta ? infoBox("AWB / Tracking ID", awb) : "",
    hasExpectedDelivery ? infoBox("Expected Delivery", formatDate(expectedDelivery)) : "",
  ]
    .filter(Boolean)
    .join("");

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
  .miray-btn-secondary{background:#232326!important;color:#ffffff!important;border-color:rgba(255,255,255,.08)!important;}
  .miray-header{background:linear-gradient(180deg,#18181b 0%,#0f0f10 100%)!important;}
  .miray-header p,.miray-header span,.miray-header div{color:#e4e4e7!important;}
  .miray-header h1,.miray-header b{color:#ffffff!important;}
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
    Order Shipped
  </p>

  <h1 style="margin:0;font-size:18px;letter-spacing:.18em;color:#ffffff;font-weight:700;">
    #${escapeHtml(orderId)}
  </h1>

  <p style="margin:12px 0 0;font-size:13px;color:#e4e4e7;line-height:1.6;">
    Shipped on <b style="color:#ffffff;">${escapeHtml(formatDate(shippedAt))}</b>
  </p>
</div>

<div style="padding:36px 40px 44px;">

<h2 class="miray-title" style="margin:0 0 10px;font-size:24px;color:#111111;">
  Hi ${escapeHtml(name)} 🚚
</h2>

<p class="miray-text" style="margin:0 0 26px;font-size:14px;line-height:1.8;color:#555555;">
  Your order is on the way. You can find your shipment details below.
</p>

<div class="miray-card" style="${cardBoxStyle}">
  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
    ${shipmentBoxes}
  </div>

  ${
    hasTracking
      ? `
  <div style="margin-top:18px;text-align:center;">
    <a href="${escapeAttr(trackingLink)}" class="miray-btn" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#111111;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border:1px solid #111111;">
      Track Shipment
    </a>
  </div>`
      : ""
  }
</div>

${
  itemsHtml
    ? `
<div style="margin-top:30px;">
  <p class="miray-muted" style="${sectionTitleStyle}">Items</p>
  ${itemsHtml}
</div>`
    : ""
}

${
  hasValidCta
    ? `
<div style="margin-top:30px;text-align:center;">
  <a href="${escapeAttr(ctaUrl)}" class="miray-btn-secondary" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#ffffff;color:#111111;text-decoration:none;font-size:13px;font-weight:600;border:1px solid rgba(0,0,0,.08);">
    View Order
  </a>
</div>`
    : ""
}

<div class="miray-card" style="margin-top:34px;padding:18px;border-radius:18px;background:#faf7f8;border:1px solid rgba(0,0,0,.05);">
  <p class="miray-text" style="margin:0;font-size:13px;line-height:1.8;color:#555555;">
    We’ll keep you updated on the next delivery milestone.
  </p>
</div>

<p class="miray-text" style="margin-top:34px;font-size:14px;line-height:1.8;color:#444444;">
  With regards,<br />
  <b class="miray-strong">Team Miray Fashions</b>
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
  const qty = Number(it?.quantity || 0);
  const price = Number(it?.price || 0);

  const thumb =
    snap?.thumbnail ||
    (Array.isArray(snap?.images) ? snap.images[0] : "") ||
    "";

  const meta = getItemMeta(it);

  return `
  <div class="miray-card" style="display:flex;gap:14px;padding:16px;border-radius:18px;border:1px solid rgba(0,0,0,.08);margin-bottom:14px;background:#ffffff;">
    ${
      thumb
        ? `<img src="${escapeAttr(thumb)}" alt="${escapeAttr(title)}" style="width:68px;height:68px;object-fit:cover;border-radius:14px;" />`
        : ""
    }

    <div style="flex:1;">
      <p class="miray-title" style="margin:0 0 8px;font-size:14px;font-weight:600;color:#111111;">
        ${escapeHtml(title)}
      </p>

      ${
        meta
          ? `<p class="miray-muted" style="margin:0 0 8px;font-size:12px;color:#666666;">${escapeHtml(meta)}</p>`
          : ""
      }

      <div class="miray-text" style="display:flex;justify-content:space-between;gap:10px;font-size:13px;color:#555555;">
        <span>Qty: ${qty}</span>
        <b class="miray-strong">${money(price, currency)}</b>
      </div>
    </div>
  </div>`;
}

function getItemMeta(it = {}) {
  const attrs = Array.isArray(it?.variant?.attributes) ? it.variant.attributes : [];

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
  <div class="miray-card" style="padding:14px 16px;border-radius:16px;border:1px solid rgba(0,0,0,.08);background:#ffffff;">
    <p class="miray-muted" style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#777777;">
      ${escapeHtml(label)}
    </p>
    <p class="miray-title" style="margin:0;font-size:14px;font-weight:600;color:#111111;word-break:break-word;">
      ${escapeHtml(value)}
    </p>
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

const sectionTitleStyle =
  "margin:0 0 12px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#777777;";

const cardBoxStyle =
  "border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:18px;background:#fcfcfc;";