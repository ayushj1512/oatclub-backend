// nodemailer/OrderConfirmationTemplate.js

export function orderConfirmationTemplate({
  name = "Customer",
  order = {},
  ctaUrl = "#",
}) {
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

  const subtotal = num(order?.subtotal);
  const discount = num(order?.discount);
  const shippingFee = num(order?.shippingFee);
  const tax = num(order?.tax);
  const finalPayable = num(order?.finalPayable);

  const couponCode = order?.coupon?.code ? String(order.coupon.code) : null;
  const items = Array.isArray(order?.items) ? order.items : [];

  const shipping = order?.shippingAddressSnapshot || {};
  const shippingName =
  shipping?.fullName ||
  shipping?.name ||
  [shipping?.firstName, shipping?.lastName].filter(Boolean).join(" ") ||
  name ||
  "Customer";
  

  const shippingPhone = shipping?.phone || shipping?.mobile || "";
  const shippingLine1 = shipping?.line1 || shipping?.address1 || "";
  const shippingLine2 = shipping?.line2 || shipping?.address2 || "";
  const shippingCity = shipping?.city || "";
  const shippingState = shipping?.state || "";
  const shippingZip = shipping?.pincode || shipping?.zip || "";
  const shippingCountry = shipping?.country || "India";

  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");

  const subject = `Order Confirmed — #${orderId} 🖤`;

  // ✅ Text fallback
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

  const itemsHtml = items.length
    ? items.map((it) => renderItemCard(it, currency)).join("")
    : `<div style="border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:16px;">
        <p style="margin:0;font-size:13px;color:rgba(0,0,0,0.75);">No items found.</p>
      </div>`;

  const discountLabel = couponCode
    ? `Discount (${escapeHtml(couponCode)})`
    : "Discount";

  const html = `
  <div style="background:#ffffff;color:#000000;padding:40px 20px;">
    <div style="max-width:680px;margin:0 auto;border:1px solid rgba(0,0,0,0.10);border-radius:30px;overflow:hidden;background:#ffffff;font-family:Poppins, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">

      <!-- Header -->
      <div style="padding:48px 40px 32px 40px;text-align:center;">
        <img
          src="https://res.cloudinary.com/djtva6hec/image/upload/v1764916639/miray/media/k0yvgu5m0ij1husm3ugh.png"
          alt="Miray Fashions Logo"
          style="height:56px;width:auto;display:block;margin:0 auto;"
        />

        <div style="margin-top:24px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.45em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            Order Confirmed
          </p>
          <h1 style="margin:12px 0 0 0;font-size:17px;letter-spacing:0.22em;font-weight:600;text-transform:uppercase;">
            #${escapeHtml(orderId)}
          </h1>
        </div>

        <div style="margin:32px auto 0 auto;height:1px;width:80px;background:rgba(0,0,0,0.20);"></div>
      </div>

      <!-- Body -->
      <div style="padding:0 40px 48px 40px;">

        <!-- Greeting -->
        <h2 style="margin:0;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
          Hi ${escapeHtml(name)} ✨
        </h2>
        <p style="margin:8px 0 0 0;font-size:13px;color:rgba(0,0,0,0.60);">
          Thank you — your order has been placed successfully.
        </p>

        <!-- Compact Status Row -->
        <div style="margin-top:28px;">
          <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;">
            <tr>
              ${statusCard("Payment", paymentMethod, paymentStatus)}
              ${statusCard("Fulfillment", fulfillmentStatus, fulfillmentSub)}
              ${statusCard("Payable", money(finalPayable, currency), "Final Amount")}
            </tr>
          </table>
        </div>

        <!-- Items -->
        <div style="margin-top:36px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.35em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            Items
          </p>

          <div style="margin-top:16px;">
            ${itemsHtml}
          </div>
        </div>

        <!-- Summary -->
        <div style="margin-top:40px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.35em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            Summary
          </p>

          <div style="margin-top:16px;border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:20px;">
            ${summaryRow("Subtotal", money(subtotal, currency))}
            ${discount > 0 ? summaryRow(discountLabel, `-${money(discount, currency)}`) : ""}
            ${couponCode ? summaryRow("Coupon", couponCode) : ""}
            ${summaryRow("Shipping", money(shippingFee, currency))}
            ${summaryRow("Tax", money(tax, currency))}
            <div style="height:1px;background:rgba(0,0,0,0.10);margin:12px 0;"></div>
            ${summaryRowStrong("Total Payable", money(finalPayable, currency))}
            <p style="margin:12px 0 0 0;font-size:11px;color:rgba(0,0,0,0.50);">
              Payment Method: ${escapeHtml(paymentMethod)}
            </p>
          </div>
        </div>

        <!-- Shipping Address -->
        <div style="margin-top:40px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.35em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            Shipping Address
          </p>

          <div style="margin-top:16px;border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:20px;">
            <p style="margin:0;font-size:13px;line-height:24px;color:rgba(0,0,0,0.80);">
              ${escapeHtml(shippingName)}<br/>
              ${escapeHtml(shippingLine1)}${shippingLine2 ? `<br/>${escapeHtml(shippingLine2)}` : ""}<br/>
              ${escapeHtml([shippingCity, shippingState, shippingZip].filter(Boolean).join(", "))}<br/>
              ${escapeHtml(shippingCountry)}
              ${shippingPhone ? `<br/>Phone: ${escapeHtml(shippingPhone)}` : ""}
            </p>
          </div>
        </div>

        <!-- CTA -->
        ${
          hasValidCta
            ? `<div style="margin-top:40px;text-align:center;">
                <a
                  href="${escapeAttr(ctaUrl)}"
                  style="display:inline-block;border:1px solid #000000;border-radius:9999px;padding:12px 32px;font-size:13px;font-weight:600;letter-spacing:0.03em;color:#000000;text-decoration:none;"
                >
                  View Order Details
                </a>
                <p style="margin:12px 0 0 0;font-size:11px;letter-spacing:0.03em;color:rgba(0,0,0,0.45);">
                  Tracking will be available once shipped.
                </p>
              </div>`
            : ""
        }

        <!-- Signature -->
        <div style="margin-top:40px;">
          <div style="height:1px;width:64px;background:rgba(0,0,0,0.20);"></div>
          <p style="margin:20px 0 0 0;font-size:15px;line-height:28px;color:rgba(0,0,0,0.80);">
            With regards,<br/>
            <span style="font-weight:600;color:#000000;">Team Miray Fashions</span>
          </p>
        </div>

      </div>

      <!-- Footer -->
      <div style="padding:28px 40px;border-top:1px solid rgba(0,0,0,0.10);">
        <p style="margin:0;font-size:11px;line-height:22px;color:rgba(0,0,0,0.55);">
          This is an automated message. You can reply to this email for any assistance.
        </p>
      </div>

    </div>
  </div>
  `;

  return { subject, text, html };
}

/* ------------------------- Helpers ------------------------- */

function up(s) {
  return String(s || "").toUpperCase();
}

function statusCard(label, main, sub) {
  return `
    <td style="width:33.333%;padding:0 6px;vertical-align:top;">
      <div style="border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:16px;">
        <p style="margin:0;font-size:11px;letter-spacing:0.35em;color:rgba(0,0,0,0.55);text-transform:uppercase;">${escapeHtml(label)}</p>
        <p style="margin:10px 0 0 0;font-size:13px;color:rgba(0,0,0,0.85);font-weight:500;">${escapeHtml(main)}</p>
        <p style="margin:6px 0 0 0;font-size:11px;color:rgba(0,0,0,0.55);">${escapeHtml(sub)}</p>
      </div>
    </td>
  `;
}

function summaryRow(label, value) {
  return `
    <div style="display:flex;justify-content:space-between;font-size:13px;color:rgba(0,0,0,0.75);line-height:22px;margin:0 0 10px 0;">
      <span>${escapeHtml(label)}</span>
      <span>${escapeHtml(value)}</span>
    </div>
  `;
}

function summaryRowStrong(label, value) {
  return `
    <div style="display:flex;justify-content:space-between;font-size:14px;color:#000000;font-weight:600;line-height:22px;margin-top:6px;">
      <span>${escapeHtml(label)}</span>
      <span>${escapeHtml(value)}</span>
    </div>
  `;
}

function renderItemCard(it, currency) {
  const snap = it?.productSnapshot || {};
  const variant = it?.variant || {};
  const title = snap?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);

  const thumb =
    variant?.image ||
    snap?.thumbnail ||
    (Array.isArray(snap?.images) && snap.images[0]) ||
    "";

  const attrsText = formatAttrs(variant?.attributes || {});

  return `
    <div style="border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:16px;margin:0 0 14px 0;display:flex;gap:14px;">
      ${
        thumb
          ? `<img src="${escapeAttr(thumb)}" alt="Product"
              style="height:64px;width:64px;border-radius:12px;object-fit:cover;border:1px solid rgba(0,0,0,0.10);" />`
          : `<div style="height:64px;width:64px;border-radius:12px;background:rgba(0,0,0,0.04);border:1px solid rgba(0,0,0,0.10);"></div>`
      }

      <div style="flex:1;">
        <p style="margin:0;font-size:14px;font-weight:600;color:#000000;">
          ${escapeHtml(title)}
        </p>

        ${
          attrsText
            ? `<p style="margin:6px 0 0 0;font-size:12px;color:rgba(0,0,0,0.60);">
                 ${escapeHtml(attrsText)}
               </p>`
            : ""
        }

        <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;">
          <p style="margin:0;font-size:12px;color:rgba(0,0,0,0.70);">Qty: ${escapeHtml(qty)}</p>
          <p style="margin:0;font-size:13px;font-weight:600;color:#000000;">
            ${escapeHtml(money(price, currency))}
          </p>
        </div>
      </div>
    </div>
  `;
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

function formatItemText(it, i, currency) {
  const snap = it?.productSnapshot || {};
  const variant = it?.variant || {};
  const title = snap?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);
  const attrsText = formatAttrs(variant?.attributes || {});
  return `${i}. ${title}${attrsText ? ` (${attrsText})` : ""} — Qty: ${qty} — ${money(price, currency)}`;
}

function money(value, currency = "INR") {
  const n = num(value);
  return currency === "INR" ? `₹${formatNumber(n)}` : `${currency} ${formatNumber(n)}`;
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
