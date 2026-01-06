// to inform stakeholders that order has been recieved 

// nodemailer/OrderReceivedTemplate.js

export function orderReceivedTemplate({
  order = {},
  concernTo = null, // optional: add extra internal recipient if needed
}) {
  const orderId = order?.orderId || order?.orderNumber || order?._id || "—";
  const currency = order?.currency || "INR";

  const paymentMethod = String(order?.paymentMethod || "cod").toUpperCase();
  const paymentStatus = String(order?.paymentStatus || "pending").toUpperCase();
  const fulfillmentStatus = String(order?.fulfillmentStatus || "processing").toUpperCase();

  const subtotal = num(order?.subtotal);
  const discount = num(order?.discount);
  const shippingFee = num(order?.shippingFee);
  const tax = num(order?.tax);
  const totalAmount = num(order?.totalAmount);
  const finalPayable = num(order?.finalPayable);

  const couponCode = order?.coupon?.code ? String(order.coupon.code) : null;
  const source = String(order?.source || "website");

  // customer details (depends on your schema; keeping multiple fallbacks)
  const customerName =
    order?.customerSnapshot?.name ||
    order?.customerName ||
    order?.customerId?.name ||
    "Customer";
  const customerEmail =
    order?.customerSnapshot?.email ||
    order?.customerEmail ||
    order?.customerId?.email ||
    "—";
  const customerPhone =
    order?.customerSnapshot?.phone ||
    order?.customerPhone ||
    order?.customerId?.phone ||
    "";

  const items = Array.isArray(order?.items) ? order.items : [];

  const shipping = order?.shippingAddressSnapshot || {};
  const shippingName =
    shipping?.name ||
    [shipping?.firstName, shipping?.lastName].filter(Boolean).join(" ") ||
    customerName ||
    "Customer";

  const shippingPhone = shipping?.phone || shipping?.mobile || customerPhone || "";
  const shippingLine1 = shipping?.line1 || shipping?.address1 || "";
  const shippingLine2 = shipping?.line2 || shipping?.address2 || "";
  const shippingCity = shipping?.city || "";
  const shippingState = shipping?.state || "";
  const shippingZip = shipping?.pincode || shipping?.zip || "";
  const shippingCountry = shipping?.country || "India";

  const subject = `🛒 New Order Received — #${orderId} (${money(finalPayable, currency)})`;

  // ✅ Plain text fallback
  const text = `New Order Received ✅

Order: ${orderId}
Source: ${source}
Payment: ${paymentMethod} (${paymentStatus})
Fulfillment: ${fulfillmentStatus}
Total Payable: ${money(finalPayable, currency)}

Customer:
${customerName}
${customerEmail}${shippingPhone ? `\n${shippingPhone}` : ""}

Items:
${items.map((it, i) => formatItemText(it, i + 1, currency)).join("\n")}

Summary:
Subtotal: ${money(subtotal, currency)}
Discount: -${money(discount, currency)}
Shipping: ${money(shippingFee, currency)}
Tax: ${money(tax, currency)}
Total: ${money(totalAmount, currency)}
Payable: ${money(finalPayable, currency)}
${couponCode ? `Coupon: ${couponCode}\n` : ""}

Shipping Address:
${shippingName}
${shippingLine1}${shippingLine2 ? `, ${shippingLine2}` : ""}
${shippingCity}${shippingState ? `, ${shippingState}` : ""} ${shippingZip}
${shippingCountry}${shippingPhone ? `\nPhone: ${shippingPhone}` : ""}

— Team Miray Fashions
`;

  const itemsHtml = items.length
    ? items.map((it) => renderAdminItemRow(it, currency)).join("")
    : `<div style="border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:16px;">
        <p style="margin:0;font-size:13px;color:rgba(0,0,0,0.75);">No items found.</p>
      </div>`;

  const discountLabel = couponCode ? `Discount (${escapeHtml(couponCode)})` : "Discount";

  // ✅ Admin-friendly compact HTML
  const html = `
  <div style="background:#ffffff;color:#000000;padding:40px 20px;">
    <div style="max-width:720px;margin:0 auto;border:1px solid rgba(0,0,0,0.10);border-radius:28px;overflow:hidden;background:#ffffff;font-family:Poppins, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">

      <!-- Header -->
      <div style="padding:40px 40px 26px 40px;text-align:center;">
        <img
          src="https://res.cloudinary.com/djtva6hec/image/upload/v1764916639/miray/media/k0yvgu5m0ij1husm3ugh.png"
          alt="Miray Fashions Logo"
          style="height:48px;width:auto;display:block;margin:0 auto;"
        />

        <div style="margin-top:18px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.45em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            New Order Received
          </p>
          <h1 style="margin:10px 0 0 0;font-size:16px;letter-spacing:0.18em;font-weight:700;text-transform:uppercase;">
            #${escapeHtml(orderId)}
          </h1>
          <p style="margin:10px 0 0 0;font-size:13px;color:rgba(0,0,0,0.75);font-weight:600;">
            ${escapeHtml(money(finalPayable, currency))}
          </p>
        </div>

        <div style="margin:22px auto 0 auto;height:1px;width:84px;background:rgba(0,0,0,0.20);"></div>
      </div>

      <!-- Body -->
      <div style="padding:0 40px 40px 40px;">

        <!-- Top Meta (3 cards) -->
        <div style="margin-top:18px;">
          <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;">
            <tr>
              ${metaCard("Payment", paymentMethod, paymentStatus)}
              ${metaCard("Fulfillment", fulfillmentStatus, "Processing")}
              ${metaCard("Source", titleCase(source), "Channel")}
            </tr>
          </table>
        </div>

        <!-- Customer -->
        <div style="margin-top:28px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.35em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            Customer
          </p>

          <div style="margin-top:12px;border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:16px;">
            <p style="margin:0;font-size:14px;font-weight:700;color:#000000;">
              ${escapeHtml(customerName)}
            </p>
            <p style="margin:8px 0 0 0;font-size:13px;color:rgba(0,0,0,0.75);line-height:22px;">
              ${escapeHtml(customerEmail)}${shippingPhone ? `<br/>${escapeHtml(shippingPhone)}` : ""}
            </p>
          </div>
        </div>

        <!-- Items -->
        <div style="margin-top:28px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.35em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            Items
          </p>

          <div style="margin-top:12px;">
            ${itemsHtml}
          </div>
        </div>

        <!-- Summary -->
        <div style="margin-top:28px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.35em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            Summary
          </p>

          <div style="margin-top:12px;border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:16px;">
            ${row("Subtotal", money(subtotal, currency))}
            ${row(discountLabel, `-${money(discount, currency)}`)}
            ${row("Shipping", money(shippingFee, currency))}
            ${row("Tax", money(tax, currency))}
            <div style="height:1px;background:rgba(0,0,0,0.10);margin:10px 0;"></div>
            ${rowStrong("Payable", money(finalPayable, currency))}
            ${couponCode ? `<p style="margin:10px 0 0 0;font-size:11px;color:rgba(0,0,0,0.50);">Coupon: ${escapeHtml(couponCode)}</p>` : ""}
          </div>
        </div>

        <!-- Shipping -->
        <div style="margin-top:28px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.35em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            Shipping Address
          </p>

          <div style="margin-top:12px;border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:16px;">
            <p style="margin:0;font-size:13px;line-height:22px;color:rgba(0,0,0,0.80);">
              ${escapeHtml(shippingName)}<br/>
              ${escapeHtml(shippingLine1)}${shippingLine2 ? `<br/>${escapeHtml(shippingLine2)}` : ""}<br/>
              ${escapeHtml([shippingCity, shippingState].filter(Boolean).join(", "))} ${escapeHtml(shippingZip)}<br/>
              ${escapeHtml(shippingCountry)}
              ${shippingPhone ? `<br/>Phone: ${escapeHtml(shippingPhone)}` : ""}
            </p>
          </div>
        </div>

        <!-- Footer line -->
        <div style="margin-top:28px;height:1px;background:rgba(0,0,0,0.10);"></div>

        <p style="margin:18px 0 0 0;font-size:12px;color:rgba(0,0,0,0.55);text-align:center;">
          — Team Miray Fashions
        </p>

      </div>
    </div>
  </div>
  `;

  return { subject, text, html };
}

/* ------------------------- Helpers ------------------------- */

function metaCard(label, main, sub) {
  return `
    <td style="width:33.333%;padding:0 6px;vertical-align:top;">
      <div style="border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:14px;">
        <p style="margin:0;font-size:11px;letter-spacing:0.35em;color:rgba(0,0,0,0.55);text-transform:uppercase;">${escapeHtml(label)}</p>
        <p style="margin:10px 0 0 0;font-size:13px;color:rgba(0,0,0,0.85);font-weight:600;">${escapeHtml(main)}</p>
        <p style="margin:6px 0 0 0;font-size:11px;color:rgba(0,0,0,0.55);">${escapeHtml(sub)}</p>
      </div>
    </td>
  `;
}

function renderAdminItemRow(it, currency) {
  const snap = it?.productSnapshot || {};
  const variant = it?.variant || {};

  const title = snap?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);

  const attrsText = formatAttrs(variant?.attributes || {});
  const sku = variant?.sku ? `SKU: ${variant.sku}` : "";

  const meta = [attrsText, sku].filter(Boolean).join(" • ");

  return `
    <div style="border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:14px;margin:0 0 10px 0;">
      <p style="margin:0;font-size:14px;font-weight:700;color:#000000;">
        ${escapeHtml(title)}
      </p>
      ${meta ? `<p style="margin:6px 0 0 0;font-size:12px;color:rgba(0,0,0,0.60);">${escapeHtml(meta)}</p>` : ""}
      <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;">
        <p style="margin:0;font-size:12px;color:rgba(0,0,0,0.70);">Qty: ${escapeHtml(qty)}</p>
        <p style="margin:0;font-size:13px;font-weight:700;color:#000000;">${escapeHtml(money(price, currency))}</p>
      </div>
    </div>
  `;
}

function formatAttrs(attrs) {
  if (!attrs || typeof attrs !== "object") return "";
  const pairs = Object.entries(attrs)
    .filter(([_, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `${capitalize(k)}: ${String(v)}`);
  return pairs.join(" • ");
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
  const sku = variant?.sku ? `SKU: ${variant.sku}` : "";
  const meta = [attrsText, sku].filter(Boolean).join(" | ");
  return `${i}. ${title}${meta ? ` (${meta})` : ""} — Qty: ${qty} — ${money(price, currency)}`;
}

function row(label, value) {
  return `
    <div style="display:flex;justify-content:space-between;font-size:13px;color:rgba(0,0,0,0.75);line-height:20px;margin:0 0 10px 0;">
      <span>${escapeHtml(label)}</span>
      <span>${escapeHtml(value)}</span>
    </div>
  `;
}

function rowStrong(label, value) {
  return `
    <div style="display:flex;justify-content:space-between;font-size:14px;color:#000000;font-weight:700;line-height:20px;">
      <span>${escapeHtml(label)}</span>
      <span>${escapeHtml(value)}</span>
    </div>
  `;
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

function titleCase(s) {
  return String(s || "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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
