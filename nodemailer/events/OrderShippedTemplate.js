// nodemailer/OrderShippedTemplate.js

export function orderShippedTemplate({
  name = "Customer",
  order = {},
  ctaUrl = "#",
}) {
  /* ---------------- core ---------------- */
  const orderId = order?.orderId || order?.orderNumber || order?._id || "—";
  const currency = order?.currency || "INR";

  const shippedAt = order?.shipment?.shippedAt || new Date();
  const expectedDelivery = order?.trackingDetails?.expectedDelivery || null;

  /* ---------------- shiprocket only ---------------- */
  const awb = order?.shipment?.shiprocket?.awb || "";
  const courierName = order?.shipment?.shiprocket?.courierName || "";
  const trackingLink = order?.shipment?.shiprocket?.trackingUrl || "";

  // Show courier + AWB only when BOTH are available
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

  /* ---------------- text mail ---------------- */
  const textLines = [
    `Hi ${name},`,
    ``,
    `Your order has been shipped and is on the way.`,
    ``,
    `Order ID: ${orderId}`,
    `Shipped On: ${formatDate(shippedAt)}`,
    hasShippingMeta ? `Courier: ${courierName}` : "",
    hasShippingMeta ? `AWB / Tracking ID: ${awb}` : "",
    hasExpectedDelivery
      ? `Expected Delivery: ${formatDate(expectedDelivery)}`
      : "",
    hasTracking ? `Track Shipment: ${trackingLink}` : "",
    hasValidCta ? `View Order: ${ctaUrl}` : "",
    ``,
    `Team Miray Fashions`,
  ].filter(Boolean);

  const text = textLines.join("\n");

  /* ---------------- shipment details block ---------------- */
  const shipmentBoxes = [
    infoBox("Order ID", orderId),
    hasShippingMeta ? infoBox("Courier", courierName) : "",
    hasShippingMeta ? infoBox("AWB / Tracking ID", awb) : "",
    hasExpectedDelivery
      ? infoBox("Expected Delivery", formatDate(expectedDelivery))
      : "",
  ]
    .filter(Boolean)
    .join("");

  /* ---------------- html mail ---------------- */
  const html = `
<div style="background:#ffffff;padding:40px 20px;">
  <div style="max-width:680px;margin:auto;border:1px solid rgba(0,0,0,.10);border-radius:28px;font-family:Poppins,Arial,sans-serif;overflow:hidden;">
    
    <!-- Header -->
    <div style="padding:44px 32px 26px;text-align:center;background:#faf7f8;">
      <img
        src="https://res.cloudinary.com/djtva6hec/image/upload/v1764916639/miray/media/k0yvgu5m0ij1husm3ugh.png"
        alt="Miray Fashions"
        style="height:54px;max-width:100%;"
      />
      <p style="margin:22px 0 8px;font-size:11px;letter-spacing:.35em;color:#777;text-transform:uppercase;">
        Order Shipped
      </p>
      <h1 style="margin:0;font-size:18px;color:#111;">#${escapeHtml(orderId)}</h1>
      <p style="margin:10px 0 0;font-size:13px;color:#666;">
        Shipped on <b>${escapeHtml(formatDate(shippedAt))}</b>
      </p>
    </div>

    <!-- Body -->
    <div style="padding:0 32px 40px;">
      <h2 style="margin:0 0 10px;font-size:22px;color:#111;">Hi ${escapeHtml(
        name
      )} 🚚</h2>

      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#555;">
        Your order is on the way. You can find your shipment details below.
      </p>

      <!-- Shipment Details -->
      <div style="border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:18px;background:#fcfcfc;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          ${shipmentBoxes}
        </div>

        ${
          hasTracking
            ? `
          <div style="margin-top:16px;">
            <a
              href="${escapeAttr(trackingLink)}"
              style="display:inline-block;padding:12px 20px;border-radius:999px;background:#111;color:#fff;text-decoration:none;font-size:13px;font-weight:600;"
            >
              Track Shipment
            </a>
          </div>
        `
            : ""
        }
      </div>

      ${
        itemsHtml
          ? `
        <div style="margin-top:28px;">
          <p style="margin:0 0 12px;font-size:12px;letter-spacing:.18em;color:#777;text-transform:uppercase;">
            Items
          </p>
          ${itemsHtml}
        </div>
      `
          : ""
      }

      ${
        hasValidCta
          ? `
        <div style="margin-top:28px;text-align:center;">
          <a
            href="${escapeAttr(ctaUrl)}"
            style="display:inline-block;padding:14px 24px;border-radius:999px;background:#111;color:#fff;text-decoration:none;font-size:13px;font-weight:600;"
          >
            View Order
          </a>
        </div>
      `
          : ""
      }

      <p style="margin-top:32px;font-size:13px;line-height:1.7;color:#555;">
        We’ll keep you updated on the next delivery milestone.
      </p>

      <p style="margin-top:28px;font-size:14px;color:#444;">
        With regards,<br />
        <b>Team Miray Fashions</b>
      </p>
    </div>
  </div>
</div>
`;

  return { subject, text, html };
}

/* ---------------- helpers ---------------- */

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
  <div style="border:1px solid rgba(0,0,0,.08);border-radius:16px;padding:12px;margin-top:10px;display:flex;gap:12px;align-items:flex-start;">
    ${
      thumb
        ? `<img
            src="${escapeAttr(thumb)}"
            alt="${escapeAttr(title)}"
            style="height:60px;width:60px;object-fit:cover;border-radius:10px;"
          />`
        : ""
    }
    <div style="flex:1;">
      <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#111;">
        ${escapeHtml(title)}
      </p>
      ${
        meta
          ? `<p style="margin:0 0 6px;font-size:12px;color:#666;">${escapeHtml(
              meta
            )}</p>`
          : ""
      }
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;color:#444;">
        <span>Qty: ${qty}</span>
        <b>${money(price, currency)}</b>
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

  return [size && `Size: ${size}`, color && `Color: ${color}`, sku && `SKU: ${sku}`]
    .filter(Boolean)
    .join(" • ");
}

function infoBox(label, value) {
  return `
  <div style="border:1px solid rgba(0,0,0,.06);border-radius:14px;padding:12px;background:#fff;">
    <p style="margin:0 0 5px;font-size:11px;letter-spacing:.08em;color:#777;text-transform:uppercase;">
      ${escapeHtml(label)}
    </p>
    <p style="margin:0;font-size:14px;font-weight:600;color:#111;word-break:break-word;">
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