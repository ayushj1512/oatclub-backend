// nodemailer/OrderDeliveredTemplate.js

export function orderDeliveredTemplate({
  name = "Customer",
  order = {},
  ctaUrl = "#",
}) {
  const orderId =
    order?.orderId || order?.orderNumber || order?._id || "—";

  const currency = order?.currency || "INR";

  const paymentMethod = up(order?.paymentMethod || "cod");
  const paymentStatus = up(order?.paymentStatus || "pending");
  const fulfillmentStatus = up(order?.fulfillmentStatus || "delivered");

  const deliveredAt =
    order?.shipment?.deliveredAt ||
    order?.trackingDetails?.deliveredAt ||
    order?.deliveredAt;

  const deliveredOn = deliveredAt
    ? formatDate(deliveredAt)
    : "Recently delivered";

  const subtotal = num(order?.subtotal);
  const discount = num(order?.discount);
  const shippingFee = num(order?.shippingFee);
  const tax = num(order?.tax);
  const finalPayable = num(order?.finalPayable);

  const couponCode = order?.coupon?.code || null;

  const items = Array.isArray(order?.items) ? order.items : [];

  const shipping = order?.shippingAddressSnapshot || {};

  const shippingName =
    shipping?.fullName ||
    shipping?.name ||
    [shipping?.firstName, shipping?.lastName]
      .filter(Boolean)
      .join(" ") ||
    name;

  const awb =
    order?.shipment?.shiprocket?.awb ||
    order?.trackingDetails?.trackingId ||
    "";

  const courierName =
    order?.shipment?.shiprocket?.courierName ||
    order?.trackingDetails?.courierName ||
    "";

  const trackingLink =
    order?.shipment?.shiprocket?.trackingUrl ||
    order?.trackingDetails?.trackingUrl ||
    "";

  const subject = `Order Delivered — #${orderId} 🖤`;

  const text = `Hi ${name},

Your order has been delivered successfully.

Order ID: ${orderId}
Delivered On: ${deliveredOn}
Payment: ${paymentMethod} (${paymentStatus})
Status: ${fulfillmentStatus}
Total Paid: ${money(finalPayable, currency)}

With regards,
Team Miray Fashions`;

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">

<style>
:root{
  color-scheme:light dark;
  supported-color-schemes:light dark;
}

@media (prefers-color-scheme: dark){

  body,
  .miray-bg{
    background:#0f0f10 !important;
  }

  .miray-shell{
    background:#151517 !important;
    border-color:rgba(255,255,255,.08) !important;
  }

  .miray-card{
    background:#1b1b1d !important;
    border-color:rgba(255,255,255,.08) !important;
  }

  .miray-text{
    color:#e4e4e7 !important;
  }

  .miray-muted{
    color:#b4b4b8 !important;
  }

  .miray-title,
  .miray-strong{
    color:#ffffff !important;
  }

  .miray-divider{
    background:rgba(255,255,255,.08) !important;
  }

  .miray-btn{
    background:#ffffff !important;
    color:#111111 !important;
  }

  .miray-btn-secondary{
    background:#232326 !important;
    color:#ffffff !important;
    border-color:rgba(255,255,255,.08) !important;
  }

  .miray-header{
    background:linear-gradient(180deg,#18181b 0%,#0f0f10 100%) !important;
  }

  .miray-header p,
  .miray-header span,
  .miray-header div{
    color:#e4e4e7 !important;
  }

  .miray-header h1,
  .miray-header b{
    color:#ffffff !important;
  }
}

/* Outlook Dark Mode */

[data-ogsc] .miray-bg{
  background:#0f0f10 !important;
}

[data-ogsc] .miray-shell{
  background:#151517 !important;
}

[data-ogsc] .miray-card{
  background:#1b1b1d !important;
}

[data-ogsc] .miray-text{
  color:#e4e4e7 !important;
}

[data-ogsc] .miray-muted{
  color:#b4b4b8 !important;
}

[data-ogsc] .miray-title,
[data-ogsc] .miray-strong{
  color:#ffffff !important;
}

[data-ogsc] .miray-header{
  background:linear-gradient(180deg,#18181b 0%,#0f0f10 100%) !important;
}

[data-ogsc] .miray-header p,
[data-ogsc] .miray-header span,
[data-ogsc] .miray-header div{
  color:#e4e4e7 !important;
}

[data-ogsc] .miray-header h1,
[data-ogsc] .miray-header b{
  color:#ffffff !important;
}
</style>
</head>

<body style="margin:0;padding:0;background:#ffffff;">

<div class="miray-bg" style="padding:40px 20px;background:#ffffff;">

<div
  class="miray-shell"
  style="
    max-width:680px;
    margin:auto;
    background:#ffffff;
    border:1px solid rgba(0,0,0,.08);
    border-radius:28px;
    overflow:hidden;
    font-family:Poppins,Arial,sans-serif;
  "
>

<!-- HEADER -->

<div
  class="miray-header"
  style="
    padding:48px 40px 30px;
    text-align:center;
    background:linear-gradient(180deg,#18181b 0%,#0f0f10 100%);
  "
>

<img
  src="https://res.cloudinary.com/djtva6hec/image/upload/v1778268933/miray/media/zvliktr4z5zboetdz76k.png"
  alt="Miray Fashions"
  style="height:56px;"
/>

<p
  style="
    margin:24px 0 8px;
    font-size:11px;
    letter-spacing:.42em;
    text-transform:uppercase;
    color:#d4d4d8;
  "
>
  Order Delivered
</p>

<h1
  style="
    margin:0;
    font-size:18px;
    letter-spacing:.18em;
    color:#ffffff;
    font-weight:700;
  "
>
  #${escapeHtml(orderId)}
</h1>

<p
  style="
    margin:12px 0 0;
    font-size:13px;
    color:#e4e4e7;
    line-height:1.6;
  "
>
  Delivered on
  <b style="color:#ffffff;">
    ${escapeHtml(deliveredOn)}
  </b>
</p>

</div>

<!-- BODY -->

<div style="padding:36px 40px 44px;">

<h2
  class="miray-title"
  style="margin:0 0 10px;font-size:24px;color:#111111;"
>
  Hi ${escapeHtml(name)} ✨
</h2>

<p
  class="miray-text"
  style="
    margin:0 0 28px;
    font-size:14px;
    line-height:1.8;
    color:#555555;
  "
>
  Your order has been delivered successfully.
  We hope you love everything you received.
</p>

<!-- STATUS -->

<div
  style="
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:12px;
  "
>

${infoCard("Payment", paymentMethod)}
${infoCard("Payment Status", paymentStatus)}
${infoCard("Order Status", fulfillmentStatus)}
${infoCard("Amount", money(finalPayable, currency))}

${courierName ? infoCard("Courier", courierName) : ""}
${awb ? infoCard("Tracking ID", awb) : ""}

</div>

<!-- ITEMS -->

<div style="margin-top:30px;">

<p
  class="miray-muted"
  style="
    margin:0 0 12px;
    font-size:11px;
    letter-spacing:.2em;
    text-transform:uppercase;
    color:#777777;
  "
>
  Items
</p>

${items.length
  ? items.map((it) => renderItemCard(it, currency)).join("")
  : emptyCard("No items found.")}

</div>

<!-- SUMMARY -->

<div style="margin-top:30px;">

<p
  class="miray-muted"
  style="
    margin:0 0 12px;
    font-size:11px;
    letter-spacing:.2em;
    text-transform:uppercase;
    color:#777777;
  "
>
  Order Summary
</p>

<div
  class="miray-card"
  style="
    border:1px solid rgba(0,0,0,.08);
    border-radius:18px;
    padding:18px;
    background:#fcfcfc;
  "
>

${summaryRow("Subtotal", money(subtotal, currency))}

${
  discount > 0
    ? summaryRow(
        couponCode ? `Discount (${couponCode})` : "Discount",
        `- ${money(discount, currency)}`
      )
    : ""
}

${summaryRow("Shipping", money(shippingFee, currency))}
${summaryRow("Tax", money(tax, currency))}

<div
  class="miray-divider"
  style="
    height:1px;
    background:rgba(0,0,0,.08);
    margin:14px 0;
  "
></div>

${summaryRow("Total", money(finalPayable, currency), true)}

</div>

</div>

${
  trackingLink
    ? `
<div style="margin-top:30px;text-align:center;">

<a
  href="${escapeAttr(trackingLink)}"
  class="miray-btn-secondary"
  style="
    display:inline-block;
    padding:14px 22px;
    border-radius:999px;
    background:#ffffff;
    border:1px solid rgba(0,0,0,.08);
    color:#111111;
    text-decoration:none;
    font-size:13px;
    font-weight:600;
  "
>
  Track Shipment
</a>

</div>
`
    : ""
}

${
  ctaUrl && ctaUrl !== "#"
    ? `
<div style="margin-top:18px;text-align:center;">

<a
  href="${escapeAttr(ctaUrl)}"
  class="miray-btn"
  style="
    display:inline-block;
    padding:15px 24px;
    border-radius:999px;
    background:#111111;
    color:#ffffff;
    text-decoration:none;
    font-size:13px;
    font-weight:600;
  "
>
  View Order
</a>

</div>
`
    : ""
}

<div
  class="miray-card"
  style="
    margin-top:34px;
    padding:18px;
    border-radius:18px;
    background:#faf7f8;
    border:1px solid rgba(0,0,0,.05);
  "
>

<p
  class="miray-text"
  style="
    margin:0;
    font-size:13px;
    line-height:1.8;
    color:#555555;
  "
>
  Thank you for shopping with
  <b class="miray-strong">Miray Fashions</b> 🖤
</p>

</div>

<p
  class="miray-text"
  style="
    margin-top:34px;
    font-size:14px;
    line-height:1.8;
    color:#444444;
  "
>
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

  const thumb =
    snap?.thumbnail ||
    (Array.isArray(snap?.images) ? snap.images[0] : "");

  return `
  <div
    class="miray-card"
    style="
      display:flex;
      gap:14px;
      padding:16px;
      border-radius:18px;
      border:1px solid rgba(0,0,0,.08);
      margin-bottom:14px;
      background:#ffffff;
    "
  >

  ${
    thumb
      ? `
  <img
    src="${escapeAttr(thumb)}"
    alt="${escapeAttr(title)}"
    style="
      width:68px;
      height:68px;
      object-fit:cover;
      border-radius:14px;
    "
  />
  `
      : ""
  }

  <div style="flex:1;">

  <p
    class="miray-title"
    style="
      margin:0 0 8px;
      font-size:14px;
      font-weight:600;
      color:#111111;
    "
  >
    ${escapeHtml(title)}
  </p>

  <div
    class="miray-text"
    style="
      display:flex;
      justify-content:space-between;
      font-size:13px;
      color:#555555;
    "
  >
    <span>Qty: ${num(it?.quantity)}</span>
    <b class="miray-strong">
      ${money(it?.price || 0, currency)}
    </b>
  </div>

  </div>
  </div>
  `;
}

function infoCard(label, value) {
  return `
  <div
    class="miray-card"
    style="
      padding:14px 16px;
      border-radius:16px;
      border:1px solid rgba(0,0,0,.08);
      background:#fcfcfc;
    "
  >

  <p
    class="miray-muted"
    style="
      margin:0 0 6px;
      font-size:11px;
      letter-spacing:.08em;
      text-transform:uppercase;
      color:#777777;
    "
  >
    ${escapeHtml(label)}
  </p>

  <p
    class="miray-title"
    style="
      margin:0;
      font-size:14px;
      font-weight:600;
      color:#111111;
    "
  >
    ${escapeHtml(value)}
  </p>

  </div>
  `;
}

function summaryRow(label, value, strong = false) {
  return `
  <div
    class="miray-text"
    style="
      display:flex;
      justify-content:space-between;
      margin:10px 0;
      font-size:${strong ? "15px" : "13px"};
      color:#444444;
    "
  >

  <span ${strong ? 'class="miray-strong"' : ""}>
    ${escapeHtml(label)}
  </span>

  <span ${strong ? 'class="miray-strong"' : ""}>
    ${escapeHtml(value)}
  </span>

  </div>
  `;
}

function emptyCard(msg) {
  return `
  <div
    class="miray-card"
    style="
      padding:18px;
      border-radius:16px;
      border:1px dashed rgba(0,0,0,.12);
      color:#777777;
      background:#ffffff;
    "
  >
    ${escapeHtml(msg)}
  </div>
  `;
}

function formatDate(date) {
  try {
    return new Date(date).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "Recently delivered";
  }
}

const up = (s) => String(s || "").toUpperCase();

const num = (v) =>
  Number.isFinite(Number(v)) ? Number(v) : 0;

const money = (v, c) =>
  c === "INR"
    ? `₹${Number(v).toLocaleString("en-IN")}`
    : `${c} ${Number(v).toLocaleString()}`;

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m]));

const escapeAttr = escapeHtml;