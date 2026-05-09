// nodemailer/events/AdminOrderReceivedTemplate.js

export function orderReceivedAdminTemplate({
  order = {},
  ctaUrl = "#",
}) {
  const orderId = order?.orderNumber || order?._id || "—";
  const currency = order?.currency || "INR";

  const createdAt = order?.createdAt || order?.orderDate;
  const orderDate = createdAt ? formatDate(createdAt) : "";

  const shipping = order?.shippingAddressSnapshot || {};
  const billing = order?.billingAddressSnapshot || {};

  const customerName =
    shipping?.fullName ||
    billing?.fullName ||
    order?.customer?.name ||
    "Customer";

  const customerEmail =
    shipping?.email ||
    billing?.email ||
    order?.customer?.email ||
    "—";

  const customerPhone =
    shipping?.phone ||
    billing?.phone ||
    order?.customer?.phone ||
    "—";

  const shippingAddress = [
    shipping?.fullName,
    shipping?.line1,
    shipping?.line2,
    shipping?.city,
    shipping?.state,
    shipping?.pincode,
    shipping?.country,
  ]
    .filter(Boolean)
    .join(", ");

  const paymentMethod = pretty(order?.paymentMethod || "cod");
  const paymentStatus = pretty(order?.paymentStatus || "pending");
  const fulfillmentStatus = pretty(
    order?.fulfillmentStatus || "processing"
  );

  const razorpay = order?.razorpay || {};

  const paymentRef =
    razorpay?.paymentId ||
    razorpay?.orderId ||
    order?.transactionId ||
    "—";

  const subtotal = num(order?.subtotal);
  const discount = num(order?.discount);
  const shippingFee = num(order?.shippingFee);
  const tax = num(order?.tax);
  const totalAmount = num(order?.totalAmount);
  const finalPayable = num(order?.finalPayable);

  const coupon = order?.coupon || {};
  const couponCode = coupon?.code || null;
  const couponDiscount = num(coupon?.discount);

  const items = Array.isArray(order?.items) ? order.items : [];
  const totalQty = items.reduce(
    (sum, it) => sum + num(it?.quantity),
    0
  );

  const source = order?.source || "website";
  const priority = order?.priority || "normal";
  const isGiftOrder = order?.isGiftOrder ? "Yes" : "No";
  const isConfirmed = order?.isConfirmed ? "Yes" : "No";

  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");

  const subject = `🆕 New Order Received — #${orderId}`;

  const text = `
NEW ORDER RECEIVED

Order ID: ${orderId}
Order Date: ${orderDate}

Customer:
Name: ${customerName}
Email: ${customerEmail}
Phone: ${customerPhone}

Shipping Address:
${shippingAddress}

Payment:
Method: ${paymentMethod}
Status: ${paymentStatus}
Reference: ${paymentRef}

Fulfillment Status: ${fulfillmentStatus}
Order Confirmed: ${isConfirmed}

Items (${items.length} items | Qty ${totalQty}):
${items.map((it, i) => formatItemText(it, i + 1, currency)).join("\n")}

Pricing:
Subtotal: ${money(subtotal, currency)}
Discount: -${money(discount, currency)}
Shipping: ${money(shippingFee, currency)}
Tax: ${money(tax, currency)}
Total Amount: ${money(totalAmount, currency)}
Final Payable: ${money(finalPayable, currency)}

Coupon:
${
  couponCode
    ? `${couponCode} (-${money(couponDiscount, currency)})`
    : "—"
}

Other:
Source: ${source}
Priority: ${priority}
Gift Order: ${isGiftOrder}

${hasValidCta ? `Open Order: ${ctaUrl}` : ""}
`.trim();

  const itemsHtml = items.length
    ? items.map((it) => renderItemRow(it, currency)).join("")
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

<div class="miray-shell" style="max-width:760px;margin:auto;background:#ffffff;border:1px solid rgba(0,0,0,.08);border-radius:28px;overflow:hidden;font-family:Poppins,Arial,sans-serif;">

<div class="miray-header" style="padding:48px 40px 30px;text-align:center;background:linear-gradient(180deg,#18181b 0%,#0f0f10 100%);">

  <img
    src="https://res.cloudinary.com/djtva6hec/image/upload/v1778268933/miray/media/zvliktr4z5zboetdz76k.png"
    alt="Miray Fashions"
    style="height:56px;max-width:100%;"
  />

  <p style="margin:24px 0 8px;font-size:11px;letter-spacing:.42em;text-transform:uppercase;color:#d4d4d8;">
    New Order Received
  </p>

  <h1 style="margin:0;font-size:18px;letter-spacing:.14em;color:#ffffff;font-weight:700;">
    #${escapeHtml(orderId)}
  </h1>

  <p style="margin:12px 0 0;font-size:13px;color:#e4e4e7;line-height:1.6;">
    Final Payable
    <b style="color:#ffffff;">
      ${escapeHtml(money(finalPayable, currency))}
    </b>
  </p>
</div>

<div style="padding:36px 40px 44px;">

<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;">
  ${infoCard("Payment", paymentMethod)}
  ${infoCard("Status", fulfillmentStatus)}
  ${infoCard("Confirmed", isConfirmed)}
</div>

<div style="margin-top:30px;">
  <p class="miray-muted" style="${sectionTitleStyle}">
    Customer
  </p>

  <div class="miray-card" style="${cardBoxStyle}">
    <p class="miray-title" style="margin:0;font-size:15px;font-weight:700;color:#111111;">
      ${escapeHtml(customerName)}
    </p>

    <p class="miray-text" style="margin:10px 0 0;font-size:13px;line-height:1.8;color:#555555;">
      Email: ${escapeHtml(customerEmail)}<br/>
      Phone: ${escapeHtml(customerPhone)}
    </p>
  </div>
</div>

<div style="margin-top:30px;">
  <p class="miray-muted" style="${sectionTitleStyle}">
    Shipping Address
  </p>

  <div class="miray-card" style="${cardBoxStyle}">
    <p class="miray-text" style="margin:0;font-size:13px;line-height:1.8;color:#555555;">
      ${escapeHtml(shippingAddress || "—")}
    </p>
  </div>
</div>

<div style="margin-top:30px;">
  <p class="miray-muted" style="${sectionTitleStyle}">
    Items (${items.length} • Qty ${totalQty})
  </p>

  ${itemsHtml}
</div>

<div style="margin-top:30px;">
  <p class="miray-muted" style="${sectionTitleStyle}">
    Pricing
  </p>

  <div class="miray-card" style="${cardBoxStyle}">
    ${summaryRow("Subtotal", money(subtotal, currency))}
    ${summaryRow("Discount", `-${money(discount, currency)}`)}
    ${summaryRow("Shipping", money(shippingFee, currency))}
    ${summaryRow("Tax", money(tax, currency))}
    <div class="miray-divider" style="height:1px;background:rgba(0,0,0,.08);margin:14px 0;"></div>
    ${summaryRowStrong(
      "Final Payable",
      money(finalPayable, currency)
    )}

    ${
      couponCode
        ? `
    <p class="miray-muted" style="margin:12px 0 0;font-size:12px;color:#777777;">
      Coupon: <b class="miray-strong">${escapeHtml(
        couponCode
      )}</b> (-${escapeHtml(
            money(couponDiscount, currency)
          )})
    </p>`
        : ""
    }
  </div>
</div>

<div style="margin-top:30px;">
  <p class="miray-muted" style="${sectionTitleStyle}">
    Meta
  </p>

  <div class="miray-card" style="${cardBoxStyle}">
    <p class="miray-text" style="margin:0;font-size:13px;line-height:1.8;color:#555555;">
      Source: <b class="miray-strong">${escapeHtml(source)}</b><br/>
      Priority: <b class="miray-strong">${escapeHtml(priority)}</b><br/>
      Gift Order: <b class="miray-strong">${escapeHtml(isGiftOrder)}</b><br/>
      Payment Ref: <b class="miray-strong">${escapeHtml(paymentRef)}</b>
    </p>
  </div>
</div>

${
  hasValidCta
    ? `
<div style="margin-top:30px;text-align:center;">
  <a href="${escapeAttr(
    ctaUrl
  )}" class="miray-btn" style="display:inline-block;padding:15px 26px;border-radius:999px;background:#111111;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border:1px solid #111111;">
    Open Order in Admin
  </a>
</div>`
    : ""
}

<p class="miray-muted" style="margin-top:30px;font-size:11px;color:#777777;">
  This is an automated notification.
</p>

</div>

<div class="miray-footer" style="padding:24px 40px;border-top:1px solid rgba(0,0,0,.08);">
  <p class="miray-muted" style="margin:0;font-size:11px;line-height:1.8;color:#777777;">
    Miray Fashions Admin Notification
  </p>
</div>

</div>
</div>
</body>
</html>
`.trim();

  return { subject, text, html };
}

/* ---------------- HELPERS ---------------- */

function renderItemRow(it, currency) {
  const title = it?.productSnapshot?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);

  const attrs = extractVariantInfo(it);
  const img = getItemImage(it);

  return `
  <div class="miray-card" style="display:flex;gap:14px;padding:16px;border-radius:18px;border:1px solid rgba(0,0,0,.08);margin-bottom:14px;background:#ffffff;">

    ${
      img
        ? `
    <img
      src="${escapeAttr(img)}"
      alt="${escapeAttr(title)}"
      style="width:72px;height:72px;object-fit:cover;border-radius:14px;border:1px solid rgba(0,0,0,.06);"
    />`
        : ""
    }

    <div style="flex:1;">
      <p class="miray-title" style="margin:0;font-size:14px;font-weight:700;color:#111111;">
        ${escapeHtml(title)}
      </p>

      ${
        attrs
          ? `
      <p class="miray-muted" style="margin:8px 0 0;font-size:12px;color:#666666;">
        ${escapeHtml(attrs)}
      </p>`
          : ""
      }

      <p class="miray-text" style="margin:10px 0 0;font-size:13px;color:#555555;">
        Qty: <b class="miray-strong">${qty}</b> •
        Price: <b class="miray-strong">${escapeHtml(
          money(price, currency)
        )}</b>
      </p>
    </div>
  </div>`;
}

function infoCard(label, value) {
  return `
  <div class="miray-card" style="padding:14px 16px;border-radius:16px;border:1px solid rgba(0,0,0,.08);background:#fcfcfc;">
    <p class="miray-muted" style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#777777;">
      ${escapeHtml(label)}
    </p>

    <p class="miray-title" style="margin:0;font-size:14px;font-weight:700;color:#111111;">
      ${escapeHtml(value)}
    </p>
  </div>`;
}

function emptyCard(msg) {
  return `
  <div class="miray-card miray-muted" style="padding:18px;border-radius:16px;border:1px dashed rgba(0,0,0,.12);color:#777777;background:#ffffff;">
    ${escapeHtml(msg)}
  </div>`;
}

function summaryRow(label, value) {
  return `
  <div class="miray-text" style="display:flex;justify-content:space-between;gap:12px;margin:6px 0;font-size:13px;color:#555555;">
    <span>${escapeHtml(label)}</span>
    <span class="miray-strong" style="font-weight:700;color:#111111;">
      ${escapeHtml(value)}
    </span>
  </div>`;
}

function summaryRowStrong(label, value) {
  return `
  <div class="miray-text" style="display:flex;justify-content:space-between;gap:12px;margin:8px 0;font-size:15px;color:#111111;font-weight:800;">
    <span>${escapeHtml(label)}</span>
    <span>${escapeHtml(value)}</span>
  </div>`;
}

function extractVariantInfo(it = {}) {
  const snap = it?.productSnapshot || {};
  const variant = it?.variant || {};
  const attrs = Array.isArray(variant?.attributes)
    ? variant.attributes
    : [];

  const size =
    it?.selectedSize ||
    attrs.find(
      (a) => String(a?.key || "").toLowerCase() === "size"
    )?.value ||
    "";

  const color =
    it?.selectedColor ||
    attrs.find((a) =>
      ["color", "colour"].includes(
        String(a?.key || "").toLowerCase()
      )
    )?.value ||
    "";

  const sku = variant?.sku || snap?.sku || "";

  return [
    size && `Size: ${size}`,
    color && `Color: ${color}`,
    sku && `SKU: ${sku}`,
  ]
    .filter(Boolean)
    .join(" • ");
}

function getItemImage(it = {}) {
  const snap = it?.productSnapshot || {};

  const thumb = String(snap?.thumbnail || "").trim();

  const img0 = Array.isArray(snap?.images)
    ? String(snap.images[0] || "").trim()
    : "";

  return thumb || img0 || "";
}

function formatItemText(it, i, currency) {
  const title = it?.productSnapshot?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);

  const attrs = extractVariantInfo(it);

  return `${i}. ${title}${
    attrs ? ` (${attrs})` : ""
  } — Qty: ${qty} — ${money(price, currency)}`;
}

const num = (v) =>
  Number.isFinite(Number(v)) ? Number(v) : 0;

const money = (v, c) =>
  c === "INR"
    ? `₹${Number(v).toLocaleString("en-IN")}`
    : `${c} ${Number(v)}`;

const pretty = (s) =>
  String(s || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

function formatDate(d) {
  try {
    return new Date(d).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
      hour12: true,
    });
  } catch {
    return "";
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const escapeAttr = escapeHtml;

const sectionTitleStyle =
  "margin:0 0 12px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#777777;";

const cardBoxStyle =
  "border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:18px;background:#fcfcfc;";