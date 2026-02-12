// nodemailer/events/AdminOrderReceivedTemplate.js

export function orderReceivedAdminTemplate({ order = {}, ctaUrl = "#" }) {
  /* ================= CORE ================= */

  const orderId = order?.orderNumber || order?._id || "—";
  const currency = order?.currency || "INR";

  const createdAt = order?.createdAt || order?.orderDate;
  const orderDate = createdAt ? formatDate(createdAt) : "";

  /* ================= CUSTOMER ================= */

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
    shipping?.line1,
    shipping?.line2,
    shipping?.city,
    shipping?.state,
    shipping?.pincode,
    shipping?.country,
  ]
    .filter(Boolean)
    .join(", ");

  /* ================= STATUS ================= */

  const paymentMethod = pretty(order?.paymentMethod || "cod");
  const paymentStatus = pretty(order?.paymentStatus || "pending");
  const fulfillmentStatus = pretty(order?.fulfillmentStatus || "processing");

  const razorpay = order?.razorpay || {};
  const paymentRef =
    razorpay?.paymentId ||
    razorpay?.orderId ||
    order?.transactionId ||
    "—";

  /* ================= AMOUNTS ================= */

  const subtotal = num(order?.subtotal);
  const discount = num(order?.discount);
  const shippingFee = num(order?.shippingFee);
  const tax = num(order?.tax);
  const totalAmount = num(order?.totalAmount);
  const finalPayable = num(order?.finalPayable);

  const coupon = order?.coupon || {};
  const couponCode = coupon?.code || null;
  const couponDiscount = num(coupon?.discount);

  /* ================= ITEMS ================= */

  const items = Array.isArray(order?.items) ? order.items : [];
  const totalQty = items.reduce((sum, it) => sum + num(it?.quantity), 0);

  /* ================= META ================= */

  const source = order?.source || "website";
  const priority = order?.priority || "normal";
  const isGiftOrder = order?.isGiftOrder ? "Yes" : "No";
  const isConfirmed = order?.isConfirmed ? "Yes" : "No";

  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");
  const subject = `🆕 New Order Received — #${orderId}`;

  /* ================= TEXT ================= */

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
${couponCode ? `${couponCode} (-${money(couponDiscount, currency)})` : "—"}

Other:
Source: ${source}
Priority: ${priority}
Gift Order: ${isGiftOrder}

${hasValidCta ? `Open Order: ${ctaUrl}` : ""}
`;

  /* ================= HTML ================= */

  const itemsHtml = items.length
    ? items.map((it) => renderItemRow(it, currency)).join("")
    : `<tr><td>No items</td></tr>`;

  const html = `
<div style="padding:30px;background:#fff;">
  <div style="max-width:720px;margin:auto;border:1px solid #ddd;border-radius:16px;font-family:system-ui;">
    <div style="padding:24px;border-bottom:1px solid #eee;">
      <h2 style="margin:0;">🆕 New Order Received</h2>
      <p style="margin:6px 0;color:#555;">#${escapeHtml(orderId)} • ${escapeHtml(orderDate)}</p>
    </div>

    <div style="padding:24px;">
      <h3>Customer</h3>
      <p>
        <b>${escapeHtml(customerName)}</b><br/>
        Email: ${escapeHtml(customerEmail)}<br/>
        Phone: ${escapeHtml(customerPhone)}
      </p>

      <h3>Shipping Address</h3>
      <p>${escapeHtml(shippingAddress)}</p>

      <h3>Status</h3>
      <p>
        Payment: <b>${escapeHtml(paymentMethod)}</b> (${escapeHtml(paymentStatus)})<br/>
        Fulfillment: <b>${escapeHtml(fulfillmentStatus)}</b><br/>
        Confirmed: <b>${escapeHtml(isConfirmed)}</b><br/>
        Payment Ref: ${escapeHtml(paymentRef)}
      </p>

      <h3>Items (${items.length} • Qty ${totalQty})</h3>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${itemsHtml}
      </table>

      <h3>Pricing</h3>
      ${summaryRow("Subtotal", money(subtotal, currency))}
      ${summaryRow("Discount", `-${money(discount, currency)}`)}
      ${summaryRow("Shipping", money(shippingFee, currency))}
      ${summaryRow("Tax", money(tax, currency))}
      <hr/>
      ${summaryRowStrong("Final Payable", money(finalPayable, currency))}

      ${
        couponCode
          ? `<p>Coupon: <b>${escapeHtml(couponCode)}</b></p>`
          : ""
      }

      <h3>Meta</h3>
      <p>
        Source: ${escapeHtml(source)}<br/>
        Priority: ${escapeHtml(priority)}<br/>
        Gift Order: ${escapeHtml(isGiftOrder)}
      </p>

      ${
        hasValidCta
          ? `<p style="margin-top:20px;">
              <a href="${escapeAttr(ctaUrl)}" style="padding:10px 20px;border:1px solid #000;border-radius:999px;text-decoration:none;">
                Open Order in Admin
              </a>
            </p>`
          : ""
      }
    </div>
  </div>
</div>
`;

  return { subject, text, html };
}

/* ================================================================= */
/* ============================ HELPERS ============================ */
/* ================================================================= */

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

  return [size && `Size: ${size}`, color && `Color: ${color}`, sku && `SKU: ${sku}`]
    .filter(Boolean)
    .join(" • ");
}

function renderItemRow(it, currency) {
  const title = it?.productSnapshot?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);
  const attrs = extractVariantInfo(it);

  return `
<tr>
  <td style="padding:10px 0;border-bottom:1px solid #eee;">
    <b>${escapeHtml(title)}</b><br/>
    ${attrs ? escapeHtml(attrs) + "<br/>" : ""}
    Qty: ${qty} • ${money(price, currency)}
  </td>
</tr>`;
}

function formatItemText(it, i, currency) {
  const title = it?.productSnapshot?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);
  const attrs = extractVariantInfo(it);
  return `${i}. ${title}${attrs ? ` (${attrs})` : ""} — Qty: ${qty} — ${money(price, currency)}`;
}

/* ================= SMALL UTILS ================= */

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v, c) => c === "INR" ? `₹${Number(v).toLocaleString("en-IN")}` : `${c} ${v}`;
const pretty = s => String(s || "").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());

function formatDate(d) {
  try {
    return new Date(d).toLocaleString("en-IN", {
      day:"2-digit",month:"short",year:"numeric",
      hour:"2-digit",minute:"2-digit"
    });
  } catch {
    return "";
  }
}

function summaryRow(label, value) {
  return `<div style="display:flex;justify-content:space-between;"><span>${label}</span><span>${value}</span></div>`;
}

function summaryRowStrong(label, value) {
  return `<div style="display:flex;justify-content:space-between;font-weight:700;"><span>${label}</span><span>${value}</span></div>`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
const escapeAttr = escapeHtml;
