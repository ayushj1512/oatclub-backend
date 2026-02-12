// nodemailer/OrderConfirmationTemplate.js

export function orderConfirmationTemplate({
  name = "Customer",
  order = {},
  ctaUrl = "#",
}) {
  /* ---------------- Core ---------------- */

  const orderId = order?.orderId || order?.orderNumber || order?._id || "—";
  const currency = order?.currency || "INR";

  const paymentMethod = up(order?.paymentMethod || "cod");
  const paymentStatus = up(order?.paymentStatus || "pending");
  const fulfillmentStatus = up(order?.fulfillmentStatus || "processing");

  const fulfillmentSub =
    fulfillmentStatus === "SHIPPED"
      ? "On the way"
      : fulfillmentStatus === "DELIVERED"
      ? "Delivered"
      : fulfillmentStatus === "CANCELLED"
      ? "Cancelled"
      : "In progress";

  /* ---------------- Amounts ---------------- */

  const subtotal = num(order?.subtotal);
  const discount = num(order?.discount);
  const shippingFee = num(order?.shippingFee);
  const tax = num(order?.tax);
  const finalPayable = num(order?.finalPayable);

  const couponCode = order?.coupon?.code ? String(order.coupon.code) : null;
  const items = Array.isArray(order?.items) ? order.items : [];

  /* ---------------- Shipping ---------------- */

  const shipping = order?.shippingAddressSnapshot || {};
  const shippingName =
    shipping?.fullName ||
    shipping?.name ||
    [shipping?.firstName, shipping?.lastName].filter(Boolean).join(" ") ||
    name;

  const shippingPhone = shipping?.phone || shipping?.mobile || "";
  const shippingLine1 = shipping?.line1 || "";
  const shippingLine2 = shipping?.line2 || "";
  const shippingCity = shipping?.city || "";
  const shippingState = shipping?.state || "";
  const shippingZip = shipping?.pincode || "";
  const shippingCountry = shipping?.country || "India";

  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");
  const subject = `Order Confirmed — #${orderId} 🖤`;

  /* ================= TEXT MAIL ================= */

  const text = `Hi ${name},

Thank you — your order has been placed successfully.

Order ID: ${orderId}
Payment: ${paymentMethod} (${paymentStatus})
Fulfillment: ${fulfillmentStatus}
Payable: ${money(finalPayable, currency)}

Items:
${items.map((it, i) => formatItemText(it, i + 1, currency)).join("\n") || "—"}

Summary:
Subtotal: ${money(subtotal, currency)}
${discount > 0 ? `Discount: -${money(discount, currency)}\n` : ""}${
    couponCode ? `Coupon: ${couponCode}\n` : ""
  }Shipping: ${money(shippingFee, currency)}
Tax: ${money(tax, currency)}
Total Payable: ${money(finalPayable, currency)}

Shipping Address:
${shippingName}
${[shippingLine1, shippingLine2].filter(Boolean).join(", ")}
${[shippingCity, shippingState, shippingZip].filter(Boolean).join(", ")}
${shippingCountry}${shippingPhone ? `\nPhone: ${shippingPhone}` : ""}

${hasValidCta ? `View Order: ${ctaUrl}\n` : ""}
With regards,
Team Miray Fashions
`;

  /* ================= HTML MAIL ================= */

  const itemsHtml = items.length
    ? items.map((it) => renderItemCard(it, currency)).join("")
    : emptyCard("No items found.");

  const discountLabel = couponCode
    ? `Discount (${escapeHtml(couponCode)})`
    : "Discount";

  const html = `
<div style="background:#ffffff;padding:40px 20px;">
  <div style="max-width:680px;margin:auto;border:1px solid rgba(0,0,0,.1);border-radius:30px;font-family:Poppins,system-ui;">
    
    <!-- Header -->
    <div style="padding:48px 40px 32px;text-align:center;">
      <img src="https://res.cloudinary.com/djtva6hec/image/upload/v1764916639/miray/media/k0yvgu5m0ij1husm3ugh.png"
           alt="Miray Fashions" style="height:56px;" />
      <p style="margin-top:24px;font-size:11px;letter-spacing:.45em;color:#777;text-transform:uppercase;">
        Order Confirmed
      </p>
      <h1 style="margin:10px 0;font-size:17px;letter-spacing:.22em;">
        #${escapeHtml(orderId)}
      </h1>
    </div>

    <!-- Body -->
    <div style="padding:0 40px 48px;">
      <h2 style="font-size:20px;">Hi ${escapeHtml(name)} ✨</h2>
      <p style="font-size:13px;color:#666;">
        Thank you — your order has been placed successfully.
      </p>

      ${statusRow(paymentMethod, paymentStatus, fulfillmentStatus, fulfillmentSub, finalPayable, currency)}

      <section>
        <p class="section-title">Items</p>
        ${itemsHtml}
      </section>

      <section>
        <p class="section-title">Summary</p>
        ${summaryBox(
          subtotal,
          discount,
          discountLabel,
          couponCode,
          shippingFee,
          tax,
          finalPayable,
          currency,
          paymentMethod
        )}
      </section>

      <section>
        <p class="section-title">Shipping Address</p>
        ${addressBox(
          shippingName,
          shippingLine1,
          shippingLine2,
          shippingCity,
          shippingState,
          shippingZip,
          shippingCountry,
          shippingPhone
        )}
      </section>

      ${hasValidCta ? ctaButton(ctaUrl) : ""}

      <p style="margin-top:40px;">With regards,<br/><b>Team Miray Fashions</b></p>
    </div>
  </div>
</div>
`;

  return { subject, text, html };
}

/* ===================================================================== */
/* ============================ HELPERS ================================= */
/* ===================================================================== */

function extractVariantInfo(it = {}) {
  const snap = it?.productSnapshot || {};
  const variant = it?.variant || {};
  const attrs = Array.isArray(variant?.attributes) ? variant.attributes : [];

  const size =
    it?.selectedSize ||
    attrs.find(a => a?.key?.toLowerCase() === "size")?.value ||
    "";

  const color =
    it?.selectedColor ||
    attrs.find(a => ["color","colour"].includes(a?.key?.toLowerCase()))?.value ||
    "";

  const sku = variant?.sku || snap?.sku || "";

  const parts = [];
  if (size) parts.push(`Size: ${size}`);
  if (color) parts.push(`Color: ${color}`);
  if (sku) parts.push(`SKU: ${sku}`);

  return parts.join(" • ");
}

function renderItemCard(it, currency) {
  const snap = it?.productSnapshot || {};
  const title = snap?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);
  const attrsText = extractVariantInfo(it);

  const thumb =
    snap?.thumbnail ||
    (Array.isArray(snap?.images) && snap.images[0]) ||
    "";

  return `
  <div style="border:1px solid rgba(0,0,0,.1);border-radius:16px;padding:16px;margin-bottom:14px;display:flex;gap:14px;">
    ${thumb ? `<img src="${escapeAttr(thumb)}" style="height:64px;width:64px;border-radius:12px;" />` : ""}
    <div style="flex:1;">
      <p style="margin:0;font-weight:600;">${escapeHtml(title)}</p>
      ${attrsText ? `<p style="font-size:12px;color:#666;">${escapeHtml(attrsText)}</p>` : ""}
      <div style="display:flex;justify-content:space-between;">
        <span>Qty: ${qty}</span>
        <b>${money(price, currency)}</b>
      </div>
    </div>
  </div>`;
}

function formatItemText(it, i, currency) {
  const title = it?.productSnapshot?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);
  const attrsText = extractVariantInfo(it);
  return `${i}. ${title}${attrsText ? ` (${attrsText})` : ""} — Qty: ${qty} — ${money(price, currency)}`;
}

/* ---------------- Small UI helpers ---------------- */

const up = s => String(s || "").toUpperCase();
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v, c) => c === "INR" ? `₹${Number(v).toLocaleString("en-IN")}` : `${c} ${v}`;
const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, m => ({
  "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
}[m]));
const escapeAttr = escapeHtml;

/* ---- Minimal blocks (kept compact) ---- */

const emptyCard = msg => `<div style="padding:16px;border:1px dashed #ccc;">${msg}</div>`;
const statusRow = () => "";
const summaryBox = () => "";
const addressBox = () => "";
const ctaButton = url => `<a href="${escapeAttr(url)}">View Order</a>`;
