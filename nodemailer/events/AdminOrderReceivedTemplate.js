// nodemailer/OrderReceivedTemplate.js

export function orderReceivedAdminTemplate({ order = {}, ctaUrl = "#" }) {
  const orderId = order?.orderId || order?.orderNumber || order?._id || "—";
  const currency = order?.currency || "INR";

  const createdAt = order?.createdAt || order?.placedAt || order?.created_on;
  const orderDate = createdAt ? formatDate(createdAt) : "";

  const customerName =
    order?.userSnapshot?.name ||
    order?.customer?.name ||
    order?.shippingAddressSnapshot?.name ||
    "Customer";

  const customerEmail =
    order?.userSnapshot?.email ||
    order?.customer?.email ||
    order?.email ||
    "";

  const customerPhone =
    order?.shippingAddressSnapshot?.phone ||
    order?.shippingAddressSnapshot?.mobile ||
    order?.phone ||
    "";

  const shipping = order?.shippingAddressSnapshot || {};
  const shipName =
    shipping?.name ||
    [shipping?.firstName, shipping?.lastName].filter(Boolean).join(" ") ||
    customerName;

  const shipCity = shipping?.city || "";
  const shipState = shipping?.state || "";
  const shipZip = shipping?.pincode || shipping?.zip || "";
  const shippingSummary = [shipCity, shipState, shipZip].filter(Boolean).join(", ");

  const paymentMethod = pretty(order?.paymentMethod || "cod");
  const paymentStatus = pretty(order?.paymentStatus || "pending");
  const fulfillmentStatus = pretty(order?.fulfillmentStatus || "processing");

  const paymentRef =
    order?.paymentRef ||
    order?.txnId ||
    order?.transactionId ||
    order?.razorpay_payment_id ||
    order?.paymentIntentId ||
    "";

  const subtotal = num(order?.subtotal);
  const discount = num(order?.discount);
  const shippingFee = num(order?.shippingFee);
  const tax = num(order?.tax);
  const finalPayable = num(order?.finalPayable);

  const couponCode = order?.coupon?.code ? String(order.coupon.code) : null;

  const items = Array.isArray(order?.items) ? order.items : [];
  const totalQty = items.reduce((sum, it) => sum + num(it?.quantity), 0);

  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");

  const subject = `✅ New Order Received — #${orderId}`;

  // ✅ Text fallback
  const text = `New order received ✅

Order ID: ${orderId}
${orderDate ? `Order Date: ${orderDate}\n` : ""}

Customer: ${customerName}
Email: ${customerEmail || "—"}
Phone: ${customerPhone || "—"}
Shipping Name: ${shipName || "—"}
${shippingSummary ? `Shipping: ${shippingSummary}\n` : ""}

Payment: ${paymentMethod} (${paymentStatus})
Fulfillment: ${fulfillmentStatus}
${paymentRef ? `Payment Ref: ${paymentRef}\n` : ""}

Items (${items.length} items • Qty ${totalQty}):
${items.map((it, i) => formatItemText(it, i + 1, currency)).join("\n") || "—"}

Summary:
Subtotal: ${money(subtotal, currency)}
${discount > 0 ? `Discount: -${money(discount, currency)}\n` : ""}${
    couponCode ? `Coupon: ${couponCode}\n` : ""
  }Shipping: ${money(shippingFee, currency)}
Tax: ${money(tax, currency)}
Total: ${money(finalPayable, currency)}

${hasValidCta ? `Open order: ${ctaUrl}` : ""}
`;

  const itemsHtml = items.length
    ? items.map((it) => renderItemRow(it, currency)).join("")
    : `<tr><td style="padding:10px 0;color:rgba(0,0,0,0.65);font-size:13px;">No items found.</td></tr>`;

  const html = `
  <div style="background:#ffffff;color:#000;padding:30px 16px;">
    <div style="max-width:640px;margin:0 auto;border:1px solid rgba(0,0,0,0.12);border-radius:18px;overflow:hidden;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;">

      <!-- Header -->
      <div style="padding:22px 24px;border-bottom:1px solid rgba(0,0,0,0.08);">
        <p style="margin:0;font-size:12px;letter-spacing:0.28em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
          New Order Received
        </p>
        <h1 style="margin:10px 0 0 0;font-size:18px;font-weight:700;">
          #${escapeHtml(orderId)}
        </h1>
        ${
          orderDate
            ? `<p style="margin:10px 0 0 0;font-size:12px;color:rgba(0,0,0,0.60);">
                Order Date: ${escapeHtml(orderDate)}
              </p>`
            : ""
        }
      </div>

      <!-- Body -->
      <div style="padding:22px 24px;">

        <p style="margin:0;font-size:14px;color:rgba(0,0,0,0.75);">
          Hi Admin, a new order has been placed. Please review the details below.
        </p>

        <!-- Customer -->
        <div style="margin-top:18px;border:1px solid rgba(0,0,0,0.10);border-radius:14px;padding:14px;">
          <p style="margin:0;font-size:12px;letter-spacing:0.25em;color:rgba(0,0,0,0.55);text-transform:uppercase;">Customer</p>
          <p style="margin:8px 0 0 0;font-size:14px;font-weight:600;color:#000;">
            ${escapeHtml(customerName)}
          </p>

          <p style="margin:6px 0 0 0;font-size:13px;color:rgba(0,0,0,0.70);line-height:20px;">
            ${customerEmail ? `Email: ${escapeHtml(customerEmail)}<br/>` : ""}
            ${customerPhone ? `Phone: ${escapeHtml(customerPhone)}<br/>` : ""}
            ${shipName ? `Ship To: ${escapeHtml(shipName)}<br/>` : ""}
            ${shippingSummary ? `Shipping: ${escapeHtml(shippingSummary)}` : ""}
          </p>
        </div>

        <!-- Status -->
        <div style="margin-top:18px;border:1px solid rgba(0,0,0,0.10);border-radius:14px;padding:14px;">
          <p style="margin:0;font-size:12px;letter-spacing:0.25em;color:rgba(0,0,0,0.55);text-transform:uppercase;">Status</p>
          <p style="margin:10px 0 0 0;font-size:13px;color:rgba(0,0,0,0.75);line-height:20px;">
            Payment: <b>${escapeHtml(paymentMethod)}</b> (${escapeHtml(paymentStatus)})<br/>
            Fulfillment: <b>${escapeHtml(fulfillmentStatus)}</b><br/>
            Total: <b>${escapeHtml(money(finalPayable, currency))}</b>
            ${couponCode ? `<br/>Coupon: <b>${escapeHtml(couponCode)}</b>` : ""}
            ${paymentRef ? `<br/>Payment Ref: <b>${escapeHtml(paymentRef)}</b>` : ""}
          </p>
        </div>

        <!-- Items -->
        <div style="margin-top:18px;border:1px solid rgba(0,0,0,0.10);border-radius:14px;padding:14px;">
          <p style="margin:0;font-size:12px;letter-spacing:0.25em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            Items (${items.length} • Qty ${totalQty})
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border-collapse:collapse;">
            ${itemsHtml}
          </table>
        </div>

        <!-- Summary -->
        <div style="margin-top:18px;border:1px solid rgba(0,0,0,0.10);border-radius:14px;padding:14px;">
          <p style="margin:0;font-size:12px;letter-spacing:0.25em;color:rgba(0,0,0,0.55);text-transform:uppercase;">Summary</p>
          <div style="margin-top:10px;font-size:13px;color:rgba(0,0,0,0.75);line-height:22px;">
            ${summaryRow("Subtotal", money(subtotal, currency))}
            ${discount > 0 ? summaryRow("Discount", `-${money(discount, currency)}`) : ""}
            ${couponCode ? summaryRow("Coupon", couponCode) : ""}
            ${summaryRow("Shipping", money(shippingFee, currency))}
            ${summaryRow("Tax", money(tax, currency))}
            <div style="height:1px;background:rgba(0,0,0,0.10);margin:10px 0;"></div>
            ${summaryRowStrong("Total", money(finalPayable, currency))}
          </div>
        </div>

        <!-- CTA -->
        ${
          hasValidCta
            ? `<div style="margin-top:22px;text-align:center;">
                <a href="${escapeAttr(ctaUrl)}"
                  style="display:inline-block;padding:12px 22px;border-radius:999px;border:1px solid #000;text-decoration:none;color:#000;font-weight:600;font-size:13px;">
                  Open Order
                </a>
                <p style="margin:10px 0 0 0;font-size:11px;color:rgba(0,0,0,0.50);">
                  Please verify payment & inventory before processing.
                </p>
              </div>`
            : ""
        }

      </div>

      <!-- Footer -->
      <div style="padding:16px 24px;border-top:1px solid rgba(0,0,0,0.08);">
        <p style="margin:0;font-size:11px;color:rgba(0,0,0,0.55);">
          Automated admin alert • Miray Fashions
        </p>
      </div>

    </div>
  </div>
  `;

  return { subject, text, html };
}

/* ------------------------- Helpers ------------------------- */

function renderItemRow(it, currency) {
  const snap = it?.productSnapshot || {};
  const variant = it?.variant || {};

  const title = snap?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);

  const attrs = formatAttrs(variant?.attributes || {});
  const attrsLine = attrs ? ` • ${attrs}` : "";

  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid rgba(0,0,0,0.08);">
        <p style="margin:0;font-size:13px;font-weight:600;color:#000;">
          ${escapeHtml(title)}
        </p>
        <p style="margin:4px 0 0 0;font-size:12px;color:rgba(0,0,0,0.65);">
          Qty: ${escapeHtml(qty)} • ${escapeHtml(money(price, currency))}${escapeHtml(attrsLine)}
        </p>
      </td>
    </tr>
  `;
}

function formatItemText(it, i, currency) {
  const snap = it?.productSnapshot || {};
  const variant = it?.variant || {};
  const title = snap?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);

  const attrs = formatAttrs(variant?.attributes || {});
  return `${i}. ${title}${attrs ? ` (${attrs})` : ""} — Qty: ${qty} — ${money(
    price,
    currency
  )}`;
}

function formatAttrs(attrs) {
  if (!attrs || typeof attrs !== "object") return "";
  return Object.entries(attrs)
    .filter(([_, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `${capitalize(k)}: ${String(v)}`)
    .join(" • ");
}

function capitalize(s) {
  return String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
}

function summaryRow(label, value) {
  return `<div style="display:flex;justify-content:space-between;">
    <span>${escapeHtml(label)}</span>
    <span>${escapeHtml(value)}</span>
  </div>`;
}

function summaryRowStrong(label, value) {
  return `<div style="display:flex;justify-content:space-between;font-weight:700;color:#000;">
    <span>${escapeHtml(label)}</span>
    <span>${escapeHtml(value)}</span>
  </div>`;
}

function money(value, currency = "INR") {
  const n = num(value);
  if (currency === "INR") return `₹${formatNumber(n)}`;
  return `${currency} ${formatNumber(n)}`;
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

function pretty(s) {
  return String(s || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateLike) {
  try {
    const d = new Date(dateLike);
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// ✅ Prevent HTML injection
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
