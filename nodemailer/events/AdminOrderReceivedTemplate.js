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
    shipping?.fullName || billing?.fullName || order?.customer?.name || "Customer";

  const customerEmail =
    shipping?.email || billing?.email || order?.customer?.email || "—";

  const customerPhone =
    shipping?.phone || billing?.phone || order?.customer?.phone || "—";

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

  /* ================= STATUS ================= */

  const paymentMethod = pretty(order?.paymentMethod || "cod");
  const paymentStatus = pretty(order?.paymentStatus || "pending");
  const fulfillmentStatus = pretty(order?.fulfillmentStatus || "processing");

  const razorpay = order?.razorpay || {};
  const paymentRef =
    razorpay?.paymentId || razorpay?.orderId || order?.transactionId || "—";

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
`.trim();

  /* ================= HTML ================= */

  const itemsHtml = items.length
    ? items.map((it) => renderItemRow(it, currency)).join("")
    : `
      <tr>
        <td style="padding:14px;border-bottom:1px solid #eee;color:#555;">
          No items
        </td>
      </tr>
    `;

  const html = `
<div style="padding:30px;background:#fff;">
  <div style="max-width:760px;margin:auto;border:1px solid #e6e6e6;border-radius:16px;overflow:hidden;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
    <div style="padding:22px 24px;border-bottom:1px solid #eee;background:#fafafa;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div>
          <h2 style="margin:0;font-size:20px;line-height:1.2;">🆕 New Order Received</h2>
          <p style="margin:6px 0 0;color:#666;font-size:13px;">
            #${escapeHtml(orderId)} • ${escapeHtml(orderDate)}
          </p>
        </div>
        <div style="text-align:right;">
          <div style="font-size:12px;color:#666;">Final Payable</div>
          <div style="font-weight:800;font-size:18px;margin-top:2px;">${escapeHtml(
            money(finalPayable, currency)
          )}</div>
        </div>
      </div>
    </div>

    <div style="padding:24px;">
      <h3 style="margin:0 0 10px;font-size:16px;">Customer</h3>
      <div style="padding:14px;border:1px solid #eee;border-radius:14px;">
        <div style="font-weight:700;">${escapeHtml(customerName)}</div>
        <div style="margin-top:6px;color:#444;font-size:13px;line-height:1.5;">
          Email: ${escapeHtml(customerEmail)}<br/>
          Phone: ${escapeHtml(customerPhone)}
        </div>
      </div>

      <h3 style="margin:18px 0 10px;font-size:16px;">Shipping Address</h3>
      <div style="padding:14px;border:1px solid #eee;border-radius:14px;color:#444;font-size:13px;line-height:1.5;">
        ${escapeHtml(shippingAddress || "—")}
      </div>

      <h3 style="margin:18px 0 10px;font-size:16px;">Status</h3>
      <div style="padding:14px;border:1px solid #eee;border-radius:14px;color:#444;font-size:13px;line-height:1.6;">
        Payment: <b>${escapeHtml(paymentMethod)}</b> (${escapeHtml(paymentStatus)})<br/>
        Fulfillment: <b>${escapeHtml(fulfillmentStatus)}</b><br/>
        Confirmed: <b>${escapeHtml(isConfirmed)}</b><br/>
        Payment Ref: ${escapeHtml(paymentRef)}
      </div>

      <h3 style="margin:18px 0 10px;font-size:16px;">Items (${items.length} • Qty ${totalQty})</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee;border-radius:14px;overflow:hidden;">
        ${itemsHtml}
      </table>

      <h3 style="margin:18px 0 10px;font-size:16px;">Pricing</h3>
      <div style="border:1px solid #eee;border-radius:14px;padding:14px;">
        ${summaryRow("Subtotal", money(subtotal, currency))}
        ${summaryRow("Discount", `-${money(discount, currency)}`)}
        ${summaryRow("Shipping", money(shippingFee, currency))}
        ${summaryRow("Tax", money(tax, currency))}
        <div style="height:1px;background:#eee;margin:10px 0;"></div>
        ${summaryRowStrong("Final Payable", money(finalPayable, currency))}
        ${
          couponCode
            ? `<div style="margin-top:10px;color:#444;font-size:13px;">Coupon: <b>${escapeHtml(
                couponCode
              )}</b> (−${escapeHtml(money(couponDiscount, currency))})</div>`
            : ""
        }
      </div>

      <h3 style="margin:18px 0 10px;font-size:16px;">Meta</h3>
      <div style="padding:14px;border:1px solid #eee;border-radius:14px;color:#444;font-size:13px;line-height:1.6;">
        Source: ${escapeHtml(source)}<br/>
        Priority: ${escapeHtml(priority)}<br/>
        Gift Order: ${escapeHtml(isGiftOrder)}
      </div>

      ${
        hasValidCta
          ? `<div style="margin-top:18px;text-align:center;">
              <a href="${escapeAttr(ctaUrl)}"
                 style="display:inline-block;padding:10px 18px;border:1px solid #111;border-radius:999px;text-decoration:none;color:#111;font-weight:700;font-size:13px;">
                Open Order in Admin
              </a>
            </div>`
          : ""
      }

      <div style="margin-top:18px;color:#999;font-size:12px;">
        This is an automated notification.
      </div>
    </div>
  </div>
</div>
`.trim();

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
    attrs.find((a) => String(a?.key || "").toLowerCase() === "size")?.value ||
    "";

  const color =
    it?.selectedColor ||
    attrs.find((a) => ["color", "colour"].includes(String(a?.key || "").toLowerCase()))
      ?.value ||
    "";

  const sku = variant?.sku || snap?.sku || "";

  return [size && `Size: ${size}`, color && `Color: ${color}`, sku && `SKU: ${sku}`]
    .filter(Boolean)
    .join(" • ");
}

/**
 * ✅ Choose best product image
 * Priority:
 * 1) productSnapshot.thumbnail
 * 2) productSnapshot.images[0]
 */
function getItemImage(it = {}) {
  const snap = it?.productSnapshot || {};
  const thumb = String(snap?.thumbnail || "").trim();
  const img0 = Array.isArray(snap?.images) ? String(snap.images[0] || "").trim() : "";
  const url = thumb || img0;
  return url || ""; // empty => hide image cell
}

function renderItemRow(it, currency) {
  const title = it?.productSnapshot?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);
  const lineSubtotal = num(it?.subtotal ?? price * qty);
  const attrs = extractVariantInfo(it);

  const img = getItemImage(it);
  const hasImg = Boolean(img);

  return `
<tr>
  <td style="padding:14px;border-bottom:1px solid #eee;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        ${
          hasImg
            ? `
          <td width="84" style="vertical-align:top;padding-right:12px;">
            <img
              src="${escapeAttr(img)}"
              alt="${escapeAttr(title)}"
              width="72"
              height="72"
              style="display:block;width:72px;height:72px;object-fit:cover;border-radius:12px;border:1px solid #eee;background:#f7f7f7;"
            />
          </td>
        `
            : ""
        }
        <td style="vertical-align:top;">
          <div style="font-weight:800;color:#111;line-height:1.2;">${escapeHtml(title)}</div>
          ${
            attrs
              ? `<div style="margin-top:6px;color:#555;font-size:12px;line-height:1.4;">${escapeHtml(
                  attrs
                )}</div>`
              : ""
          }
          <div style="margin-top:8px;color:#444;font-size:12px;">
            Qty: <b>${qty}</b> • Price: <b>${escapeHtml(money(price, currency))}</b>
            ${
              lineSubtotal
                ? ` • Line: <b>${escapeHtml(money(lineSubtotal, currency))}</b>`
                : ""
            }
          </div>
        </td>
      </tr>
    </table>
  </td>
</tr>
`.trim();
}

function formatItemText(it, i, currency) {
  const title = it?.productSnapshot?.title || "Item";
  const qty = num(it?.quantity);
  const price = num(it?.price);
  const attrs = extractVariantInfo(it);
  const img = getItemImage(it);

  return `${i}. ${title}${attrs ? ` (${attrs})` : ""} — Qty: ${qty} — ${money(
    price,
    currency
  )}${img ? ` — Image: ${img}` : ""}`;
}

/* ================= SMALL UTILS ================= */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const money = (v, c) =>
  c === "INR" ? `₹${Number(v).toLocaleString("en-IN")}` : `${c} ${Number(v)}`;

const pretty = (s) =>
  String(s || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * ✅ IST formatter (Asia/Kolkata)
 */
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

function summaryRow(label, value) {
  return `<div style="display:flex;justify-content:space-between;gap:12px;margin:4px 0;">
    <span style="color:#555;">${escapeHtml(label)}</span>
    <span style="color:#111;font-weight:600;">${escapeHtml(value)}</span>
  </div>`;
}

function summaryRowStrong(label, value) {
  return `<div style="display:flex;justify-content:space-between;gap:12px;margin:6px 0;font-weight:800;">
    <span>${escapeHtml(label)}</span>
    <span>${escapeHtml(value)}</span>
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
const escapeAttr = escapeHtml;