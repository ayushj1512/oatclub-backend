// nodemailer/OrderDeliveredTemplate.js

export function orderDeliveredTemplate({
  name = "Customer",
  order = {},
  ctaUrl = "#",
}) {
  /* ---------------- Core ---------------- */

  const orderId = order?.orderId || order?.orderNumber || order?._id || "—";
  const currency = order?.currency || "INR";

  const paymentMethod = up(order?.paymentMethod || "cod");
  const paymentStatus = up(order?.paymentStatus || "pending");
  const fulfillmentStatus = up(order?.fulfillmentStatus || "delivered");

  const deliveredAt =
    order?.shipment?.deliveredAt ||
    order?.trackingDetails?.deliveredAt ||
    order?.deliveredAt ||
    null;

  const deliveredOn = deliveredAt ? formatDate(deliveredAt) : "Recently delivered";

  /* ---------------- Amounts ---------------- */

  const subtotal = num(order?.subtotal);
  const discount = num(order?.discount);
  const shippingFee = num(order?.shippingFee);
  const tax = num(order?.tax);
  const finalPayable = num(order?.finalPayable);

  const couponCode = order?.coupon?.code ? String(order.coupon.code) : null;
  const items = Array.isArray(order?.items) ? order.items : [];

  /* ---------------- Shipping / Tracking ---------------- */

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

  const awb =
    order?.shipment?.shiprocket?.awb ||
    order?.shipment?.xpressbees?.awb ||
    order?.trackingDetails?.trackingId ||
    "";

  const courierName =
    order?.shipment?.shiprocket?.courierName ||
    order?.shipment?.xpressbees?.courierName ||
    order?.trackingDetails?.courierName ||
    "";

  const trackingLink =
    order?.shipment?.shiprocket?.trackingUrl ||
    order?.shipment?.xpressbees?.trackingUrl ||
    order?.trackingDetails?.trackingUrl ||
    "";

  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");
  const hasTracking = Boolean(trackingLink);

  const subject = `Order Delivered — #${orderId} 🖤`;

  /* ================= TEXT MAIL ================= */

  const text = `Hi ${name},

Your order has been delivered successfully.

Order ID: ${orderId}
Delivered On: ${deliveredOn}
Payment: ${paymentMethod} (${paymentStatus})
Status: ${fulfillmentStatus}
Total Paid: ${money(finalPayable, currency)}

${courierName ? `Courier: ${courierName}\n` : ""}${
    awb ? `Tracking ID: ${awb}\n` : ""
  }${hasTracking ? `Track Shipment: ${trackingLink}\n` : ""}

Items:
${items.map((it, i) => formatItemText(it, i + 1, currency)).join("\n") || "—"}

Summary:
Subtotal: ${money(subtotal, currency)}
${discount > 0 ? `Discount: -${money(discount, currency)}\n` : ""}${
    couponCode ? `Coupon: ${couponCode}\n` : ""
  }Shipping: ${money(shippingFee, currency)}
Tax: ${money(tax, currency)}
Total: ${money(finalPayable, currency)}

Delivered To:
${shippingName}
${[shippingLine1, shippingLine2].filter(Boolean).join(", ")}
${[shippingCity, shippingState, shippingZip].filter(Boolean).join(", ")}
${shippingCountry}${shippingPhone ? `\nPhone: ${shippingPhone}` : ""}

We hope you loved your Miray order ✨
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
  <div style="max-width:680px;margin:auto;border:1px solid rgba(0,0,0,.10);border-radius:30px;font-family:Poppins,Arial,system-ui,sans-serif;overflow:hidden;">
    
    <!-- Header -->
    <div style="padding:48px 40px 28px;text-align:center;background:linear-gradient(180deg,#fff 0%,#faf7f8 100%);">
      <img
        src="https://res.cloudinary.com/djtva6hec/image/upload/v1764916639/miray/media/k0yvgu5m0ij1husm3ugh.png"
        alt="Miray Fashions"
        style="height:56px;max-width:100%;"
      />
      <p style="margin:24px 0 8px;font-size:11px;letter-spacing:.42em;color:#777;text-transform:uppercase;">
        Order Delivered
      </p>
      <h1 style="margin:0;font-size:18px;letter-spacing:.18em;color:#111;">
        #${escapeHtml(orderId)}
      </h1>
      <p style="margin:12px 0 0;font-size:13px;color:#666;">
        Delivered on <b>${escapeHtml(deliveredOn)}</b>
      </p>
    </div>

    <!-- Body -->
    <div style="padding:0 40px 48px;">
      <h2 style="margin:0 0 10px;font-size:22px;color:#111;">Hi ${escapeHtml(name)} ✨</h2>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#555;">
        Your order has been delivered successfully. We hope you love everything you received.
      </p>

      ${statusRow({
        paymentMethod,
        paymentStatus,
        fulfillmentStatus,
        finalPayable,
        currency,
        courierName,
        awb,
      })}

      <section style="margin-top:28px;">
        <p style="${sectionTitleStyle}">Items</p>
        ${itemsHtml}
      </section>

      <section style="margin-top:28px;">
        <p style="${sectionTitleStyle}">Order Summary</p>
        ${summaryBox({
          subtotal,
          discount,
          discountLabel,
          shippingFee,
          tax,
          finalPayable,
          currency,
        })}
      </section>

      <section style="margin-top:28px;">
        <p style="${sectionTitleStyle}">Delivered To</p>
        ${addressBox({
          shippingName,
          shippingLine1,
          shippingLine2,
          shippingCity,
          shippingState,
          shippingZip,
          shippingCountry,
          shippingPhone,
        })}
      </section>

      ${
        hasTracking
          ? `
        <section style="margin-top:28px;">
          <p style="${sectionTitleStyle}">Tracking</p>
          <div style="border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:16px 18px;background:#fcfcfc;">
            ${
              courierName
                ? `<p style="margin:0 0 8px;font-size:13px;color:#333;"><b>Courier:</b> ${escapeHtml(courierName)}</p>`
                : ""
            }
            ${
              awb
                ? `<p style="margin:0 0 8px;font-size:13px;color:#333;"><b>Tracking ID:</b> ${escapeHtml(awb)}</p>`
                : ""
            }
            <a href="${escapeAttr(trackingLink)}" style="${secondaryButtonStyle}">
              Track Shipment
            </a>
          </div>
        </section>
      `
          : ""
      }

      ${
        hasValidCta
          ? `
        <div style="margin-top:32px;text-align:center;">
          <a href="${escapeAttr(ctaUrl)}" style="${primaryButtonStyle}">
            View Order
          </a>
        </div>
      `
          : ""
      }

      <div style="margin-top:36px;padding:18px;border-radius:18px;background:#faf7f8;border:1px solid rgba(128,0,32,.08);">
        <p style="margin:0;font-size:13px;line-height:1.7;color:#555;">
          Thank you for shopping with <b>Miray Fashions</b>. Your support means a lot to us 🖤
        </p>
      </div>

      <p style="margin-top:36px;font-size:14px;line-height:1.7;color:#444;">
        With regards,<br/>
        <b>Team Miray Fashions</b>
      </p>
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
    attrs.find((a) => String(a?.key || "").toLowerCase() === "size")?.value ||
    "";

  const color =
    it?.selectedColor ||
    attrs.find((a) =>
      ["color", "colour"].includes(String(a?.key || "").toLowerCase())
    )?.value ||
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
  <div style="border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:16px;margin-bottom:14px;display:flex;gap:14px;align-items:flex-start;background:#fff;">
    ${
      thumb
        ? `<img src="${escapeAttr(
            thumb
          )}" alt="${escapeAttr(title)}" style="height:68px;width:68px;object-fit:cover;border-radius:14px;border:1px solid rgba(0,0,0,.06);" />`
        : ""
    }
    <div style="flex:1;">
      <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#111;">${escapeHtml(title)}</p>
      ${
        attrsText
          ? `<p style="margin:0 0 8px;font-size:12px;color:#666;">${escapeHtml(attrsText)}</p>`
          : ""
      }
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;color:#444;">
        <span>Qty: ${qty}</span>
        <b style="color:#111;">${money(price, currency)}</b>
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

function statusRow({
  paymentMethod,
  paymentStatus,
  fulfillmentStatus,
  finalPayable,
  currency,
  courierName,
  awb,
}) {
  return `
  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:22px 0;">
    ${infoPill("Payment", paymentMethod)}
    ${infoPill("Payment Status", paymentStatus)}
    ${infoPill("Order Status", fulfillmentStatus)}
    ${infoPill("Amount", money(finalPayable, currency))}
    ${courierName ? infoPill("Courier", courierName) : ""}
    ${awb ? infoPill("Tracking ID", awb) : ""}
  </div>`;
}

function infoPill(label, value) {
  return `
  <div style="border:1px solid rgba(0,0,0,.08);border-radius:16px;padding:14px 16px;background:#fcfcfc;">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#777;">${escapeHtml(label)}</p>
    <p style="margin:0;font-size:14px;font-weight:600;color:#111;">${escapeHtml(value)}</p>
  </div>`;
}

function summaryBox({
  subtotal,
  discount,
  discountLabel,
  shippingFee,
  tax,
  finalPayable,
  currency,
}) {
  return `
  <div style="border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:16px 18px;background:#fcfcfc;">
    ${summaryRow("Subtotal", money(subtotal, currency))}
    ${discount > 0 ? summaryRow(discountLabel, `- ${money(discount, currency)}`) : ""}
    ${summaryRow("Shipping", money(shippingFee, currency))}
    ${summaryRow("Tax", money(tax, currency))}
    <div style="height:1px;background:rgba(0,0,0,.08);margin:12px 0;"></div>
    ${summaryRow("Total", money(finalPayable, currency), true)}
  </div>`;
}

function summaryRow(label, value, strong = false) {
  return `
  <div style="display:flex;justify-content:space-between;gap:10px;margin:8px 0;font-size:${strong ? "15px" : "13px"};color:#333;">
    <span ${strong ? 'style="font-weight:600;color:#111;"' : ""}>${escapeHtml(label)}</span>
    <span ${strong ? 'style="font-weight:700;color:#111;"' : ""}>${escapeHtml(value)}</span>
  </div>`;
}

function addressBox({
  shippingName,
  shippingLine1,
  shippingLine2,
  shippingCity,
  shippingState,
  shippingZip,
  shippingCountry,
  shippingPhone,
}) {
  return `
  <div style="border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:16px 18px;background:#fcfcfc;">
    <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#111;">${escapeHtml(shippingName)}</p>
    <p style="margin:0;font-size:13px;line-height:1.7;color:#555;">
      ${escapeHtml([shippingLine1, shippingLine2].filter(Boolean).join(", ") || "—")}<br/>
      ${escapeHtml([shippingCity, shippingState, shippingZip].filter(Boolean).join(", ") || "—")}<br/>
      ${escapeHtml(shippingCountry || "India")}
      ${shippingPhone ? `<br/>Phone: ${escapeHtml(shippingPhone)}` : ""}
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
    return "Recently delivered";
  }
}

/* ---------------- Small Helpers ---------------- */

const up = (s) => String(s || "").toUpperCase();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v, c) =>
  c === "INR"
    ? `₹${Number(v).toLocaleString("en-IN")}`
    : `${c} ${Number(v).toLocaleString()}`;

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[m];
  });

const escapeAttr = escapeHtml;

const emptyCard = (msg) =>
  `<div style="padding:16px;border:1px dashed #ccc;border-radius:14px;color:#666;">${escapeHtml(msg)}</div>`;

const sectionTitleStyle =
  "margin:0 0 12px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#777;";

const primaryButtonStyle =
  "display:inline-block;padding:14px 24px;border-radius:999px;background:#111;color:#fff;text-decoration:none;font-size:13px;font-weight:600;";

const secondaryButtonStyle =
  "display:inline-block;margin-top:8px;padding:12px 18px;border-radius:999px;background:#fff;color:#111;text-decoration:none;font-size:13px;font-weight:600;border:1px solid rgba(0,0,0,.10);";