// nodemailer/events/OrderPaymentPendingTemplate.js

export function orderPaymentPendingTemplate({
  name = "Customer",
  order = {},
  paymentLink = "#",
  expiresAt = null,
}) {
  const orderId =
    order?.orderId ||
    order?.orderNumber ||
    order?._id ||
    "—";

  const currency = order?.currency || "INR";

  const paymentMethod = up(order?.paymentMethod || "razorpay");
  const paymentStatus = up(order?.paymentStatus || "pending");

  const paymentDisplay =
    paymentStatus === "FAILED"
      ? "PAYMENT FAILED"
      : "AWAITING PAYMENT";

  const reservationExpiry = expiresAt
    ? formatDateTime(expiresAt)
    : "LIMITED TIME";

  const subtotal = num(order?.subtotal);
  const discount = num(order?.discount);
  const shippingFee = num(order?.shippingFee);
  const tax = num(order?.tax);
  const finalPayable = num(
    order?.finalPayable ?? order?.totalAmount
  );

  const couponCode = order?.coupon?.code
    ? String(order.coupon.code)
    : null;

  const items = Array.isArray(order?.items)
    ? order.items
    : [];

  const shipping =
    order?.shippingAddressSnapshot || {};

  const shippingName =
    shipping?.fullName ||
    shipping?.name ||
    [shipping?.firstName, shipping?.lastName]
      .filter(Boolean)
      .join(" ") ||
    name;

  const shippingPhone =
    shipping?.phone ||
    shipping?.mobile ||
    "";

  const shippingLine1 = shipping?.line1 || "";
  const shippingLine2 = shipping?.line2 || "";
  const shippingCity = shipping?.city || "";
  const shippingState = shipping?.state || "";
  const shippingZip = shipping?.pincode || "";
  const shippingCountry =
    shipping?.country === "IN"
      ? "India"
      : shipping?.country || "India";

  const hasValidPaymentLink = Boolean(
    paymentLink && paymentLink !== "#"
  );

  const subject = `Complete Your OATCLUB Order — #${orderId}`;

  const text = `Hi ${name},

We could not confirm the payment for your OATCLUB order.

Order ID: ${orderId}
Payment Method: ${paymentMethod}
Payment Status: ${paymentDisplay}
Amount Payable: ${money(finalPayable, currency)}
Reserved Until: ${reservationExpiry}

Your selected pieces are still waiting for you.

You do not need to place a new order. Simply complete the payment using the secure link below.

Items:
${items
      .map((item, index) =>
        formatItemText(item, index + 1, currency)
      )
      .join("\n") || "—"
    }

${hasValidPaymentLink
      ? `Complete Payment: ${paymentLink}\n\n`
      : ""
    }Need help? Reply to this email and our team will assist you.

With regards,
Team OATCLUB`;

  const itemsHtml = items.length
    ? items
      .map((item) =>
        renderItemCard(item, currency)
      )
      .join("")
    : emptyCard("No items found.");

  const discountLabel = couponCode
    ? `Discount (${escapeHtml(couponCode)})`
    : "Discount";

  const html = `
<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  />
  <meta name="color-scheme" content="light" />
  <meta
    name="supported-color-schemes"
    content="light"
  />

  <style>
    body {
      margin: 0;
      padding: 0;
      background: #f2f2f2;
      color: #111111;
      font-family: Arial, Helvetica, sans-serif;
    }

    table {
      border-spacing: 0;
      border-collapse: collapse;
    }

    img {
      border: 0;
      display: block;
    }

    .oat-bg {
      width: 100%;
      background: #f2f2f2;
      padding: 24px 12px;
    }

    .oat-shell {
      width: 100%;
      max-width: 680px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 22px;
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(34, 24, 18, 0.14);
    }

    .oat-top {
      background: #111111;
      color: #ffffff;
      text-align: center;
      padding: 11px 18px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 3px;
      text-transform: uppercase;
    }

    .oat-header {
      padding: 26px 24px 20px;
      text-align: center;
    }

    .oat-logo {
      width: 112px;
      max-width: 160px;
      height: auto;
      margin: 0 auto;
    }

    .oat-kicker {
      margin: 16px 0 7px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 3px;
      color: #666666;
      text-transform: uppercase;
    }

    .oat-title {
      margin: 0;
      font-size: 28px;
      line-height: 1.1;
      font-weight: 800;
      color: #111111;
    }

    .oat-subtitle {
      margin: 10px 0 0;
      font-size: 13px;
      line-height: 1.7;
      color: #666666;
    }

    .oat-body {
      padding: 8px 24px 26px;
    }

    .oat-greeting {
      margin: 0;
      font-size: 21px;
      line-height: 1.2;
      font-weight: 800;
      color: #111111;
    }

    .oat-copy {
      margin: 10px 0 0;
      font-size: 14px;
      line-height: 1.75;
      color: #4a4a4a;
    }

    .oat-grid {
      width: 100%;
      margin-top: 18px;
    }

    .oat-grid-cell {
      width: 50%;
      vertical-align: top;
      padding: 6px;
    }

    .oat-info {
      background: #f7f7f7;
      padding: 14px;
      border-radius: 14px;
      border: 1px solid #eeeeee;
    }

    .oat-info-label {
      margin: 0 0 7px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1.5px;
      color: #777777;
      text-transform: uppercase;
    }

    .oat-info-value {
      margin: 0;
      font-size: 13px;
      line-height: 1.4;
      font-weight: 800;
      color: #111111;
      word-break: break-word;
    }

    .oat-section {
      margin-top: 20px;
    }

    .oat-section-title {
      margin: 0 0 9px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 2px;
      color: #111111;
      text-transform: uppercase;
    }

    .oat-card {
      background: #fafafa;
      padding: 14px;
      border-radius: 16px;
      border: 1px solid #eeeeee;
    }

    .oat-item {
      width: 100%;
      background: #ffffff;
      margin-bottom: 10px;
      border-radius: 16px;
      border: 1px solid #eeeeee;
      overflow: hidden;
    }

    .oat-item-image-cell {
      width: 92px;
      padding: 12px;
      vertical-align: top;
    }

    .oat-thumb {
      width: 72px;
      height: 88px;
      object-fit: cover;
      border-radius: 12px;
    }

    .oat-item-content {
      padding: 12px 12px 12px 2px;
      vertical-align: top;
    }

    .oat-item-title {
      margin: 0 0 7px;
      font-size: 14px;
      line-height: 1.4;
      font-weight: 800;
      color: #111111;
    }

    .oat-item-meta {
      margin: 0 0 10px;
      font-size: 12px;
      line-height: 1.6;
      color: #666666;
    }

    .oat-item-bottom {
      width: 100%;
      font-size: 13px;
      color: #4a4a4a;
    }

    .oat-item-price {
      text-align: right;
      font-weight: 800;
      color: #111111;
    }

    .oat-row {
      width: 100%;
      border-bottom: 1px solid #e7e7e7;
    }

    .oat-row:last-child {
      border-bottom: 0;
    }

    .oat-row td {
      padding: 8px 0;
      font-size: 13px;
      color: #4a4a4a;
    }

    .oat-row-value {
      text-align: right;
      font-weight: 700;
      color: #111111 !important;
    }

    .oat-total td {
      padding-top: 13px;
      font-size: 16px;
      font-weight: 800;
      color: #111111;
    }

    .oat-btn-wrap {
      margin-top: 22px;
      text-align: center;
    }

    .oat-btn {
      display: inline-block;
      background: #111111;
      color: #ffffff !important;
      text-decoration: none;
      padding: 15px 25px;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 1.5px;
      border-radius: 999px;
      text-transform: uppercase;
    }

    .oat-note-card {
      margin-top: 18px;
      background: #f6f6f6;
      padding: 15px;
      border-radius: 16px;
      border: 1px solid #eeeeee;
    }

    .oat-footer {
      padding: 21px 26px;
      background: #111111;
      color: #ffffff;
      text-align: center;
    }

    .oat-footer p {
      margin: 0;
      font-size: 10px;
      line-height: 1.8;
      font-weight: 700;
      letter-spacing: 1.5px;
      color: #ffffff;
      text-transform: uppercase;
    }

    @media only screen and (max-width: 620px) {
      .oat-bg {
        padding: 10px 6px !important;
      }

      .oat-header,
      .oat-body {
        padding-left: 17px !important;
        padding-right: 17px !important;
      }

      .oat-title {
        font-size: 25px !important;
      }

      .oat-greeting {
        font-size: 21px !important;
      }

      .oat-grid-cell {
        display: block !important;
        width: 100% !important;
        box-sizing: border-box;
      }

      .oat-item-image-cell {
        width: 82px !important;
      }

      .oat-thumb {
        width: 64px !important;
        height: 80px !important;
      }
    }
  </style>
</head>

<body>
  <div class="oat-bg">
    <div class="oat-shell">

      <div class="oat-top">
        OATCLUB / COMPLETE YOUR ORDER
      </div>

      <div class="oat-header">
        <img
          class="oat-logo"
          src="https://res.cloudinary.com/dpsvrt4sd/image/upload/v1780338447/qavpt44lsxsy3wrvuwi8.png"
          alt="OATCLUB"
        />

        <p class="oat-kicker">
          Payment Pending
        </p>

        <h1 class="oat-title">
          Complete Your Order
        </h1>

        <p class="oat-subtitle">
          Order #${escapeHtml(orderId)}
          &nbsp;•&nbsp;
          <b>${escapeHtml(paymentDisplay)}</b>
        </p>
      </div>

      <div class="oat-body">

        <h2 class="oat-greeting">
          Hi ${escapeHtml(name)},
        </h2>

        <p class="oat-copy">
          We could not confirm your payment. Your selected
          pieces are still reserved for a limited time, and
          you do not need to place a new order.
        </p>

        <div class="oat-note-card">
          <p class="oat-copy" style="margin:0;">
            Complete your payment soon to avoid your selected
            styles becoming unavailable.
          </p>
        </div>

        <table
          role="presentation"
          class="oat-grid"
        >
          <tr>
            ${infoCard(
    "Order Number",
    `#${orderId}`
  )}

            ${infoCard(
    "Payment Status",
    paymentDisplay
  )}
          </tr>

          <tr>
            ${infoCard(
    "Amount Payable",
    money(finalPayable, currency)
  )}

            ${infoCard(
    "Reserved Until",
    reservationExpiry
  )}
          </tr>
        </table>

        <div class="oat-section">
          <p class="oat-section-title">
            Items
          </p>

          ${itemsHtml}
        </div>

        <div class="oat-section">
          <p class="oat-section-title">
            Order Summary
          </p>

          <div class="oat-card">
            <table
              role="presentation"
              style="width:100%;"
            >
              ${summaryRow(
    "Subtotal",
    money(subtotal, currency)
  )}

              ${discount > 0
      ? summaryRow(
        discountLabel,
        `- ${money(
          discount,
          currency
        )}`
      )
      : ""
    }

              ${couponCode
      ? summaryRow(
        "Coupon",
        couponCode
      )
      : ""
    }

              ${summaryRow(
      "Shipping",
      money(shippingFee, currency)
    )}

              ${summaryRow(
      "Tax",
      money(tax, currency)
    )}

              ${summaryRow(
      "Total Payable",
      money(finalPayable, currency),
      true
    )}
            </table>
          </div>
        </div>

        <div class="oat-section">
          <p class="oat-section-title">
            Shipping Address
          </p>

          <div class="oat-card">
            <p class="oat-item-title">
              ${escapeHtml(shippingName)}
            </p>

            <p
              class="oat-copy"
              style="margin:0;"
            >
              ${escapeHtml(
      [shippingLine1, shippingLine2]
        .filter(Boolean)
        .join(", ") || "—"
    )}
              <br/>

              ${escapeHtml(
      [
        shippingCity,
        shippingState,
        shippingZip,
      ]
        .filter(Boolean)
        .join(", ") || "—"
    )}
              <br/>

              ${escapeHtml(shippingCountry)}

              ${shippingPhone
      ? `<br/>Phone: ${escapeHtml(
        shippingPhone
      )}`
      : ""
    }
            </p>
          </div>
        </div>

        ${hasValidPaymentLink
      ? `
        <div class="oat-btn-wrap">
          <a
            href="${escapeAttr(paymentLink)}"
            class="oat-btn"
          >
            Complete Payment →
          </a>
        </div>
        `
      : ""
    }

        <div class="oat-note-card">
          <p
            class="oat-copy"
            style="margin:0;"
          >
            <b>Secure Checkout</b>
            <br/>
            Pay safely using UPI, cards or net banking.
            Once payment is confirmed, we will begin
            processing your order.
          </p>
        </div>

        <p
          class="oat-copy"
          style="margin-top:20px;"
        >
          With regards,
          <br/>
          <b>Team OATCLUB</b>
        </p>

      </div>

      <div class="oat-footer">
        <p>
          OATCLUB • OWN ALL TRENDS • hey@oatclub.in
        </p>
      </div>

    </div>
  </div>
</body>
</html>`;

  return {
    subject,
    text,
    html,
  };
}

/* ---------------- HELPERS ---------------- */

function extractVariantInfo(item = {}) {
  const productSnapshot =
    item?.productSnapshot || {};

  const variant = item?.variant || {};

  const attributes = Array.isArray(
    variant?.attributes
  )
    ? variant.attributes
    : [];

  const size =
    item?.selectedSize ||
    attributes.find(
      (attribute) =>
        String(attribute?.key || "").toLowerCase() ===
        "size"
    )?.value ||
    "";

  const color =
    item?.selectedColor ||
    attributes.find((attribute) =>
      ["color", "colour"].includes(
        String(
          attribute?.key || ""
        ).toLowerCase()
      )
    )?.value ||
    "";

  const sku =
    variant?.sku ||
    productSnapshot?.sku ||
    "";

  return [
    size ? `Size: ${size}` : "",
    color ? `Color: ${color}` : "",
    sku ? `SKU: ${sku}` : "",
  ]
    .filter(Boolean)
    .join(" • ");
}

function renderItemCard(item, currency) {
  const productSnapshot =
    item?.productSnapshot || {};

  const title =
    productSnapshot?.title || "Item";

  const quantity = num(item?.quantity);
  const price = num(item?.price);
  const attributesText =
    extractVariantInfo(item);

  const thumbnail =
    productSnapshot?.thumbnail ||
    (Array.isArray(productSnapshot?.images)
      ? productSnapshot.images[0]
      : "") ||
    "";

  return `
  <table
    role="presentation"
    class="oat-item"
  >
    <tr>
      ${thumbnail
      ? `
      <td class="oat-item-image-cell">
        <img
          class="oat-thumb"
          src="${escapeAttr(thumbnail)}"
          alt="${escapeAttr(title)}"
        />
      </td>
      `
      : ""
    }

      <td class="oat-item-content">
        <p class="oat-item-title">
          ${escapeHtml(title)}
        </p>

        ${attributesText
      ? `
        <p class="oat-item-meta">
          ${escapeHtml(attributesText)}
        </p>
        `
      : ""
    }

        <table
          role="presentation"
          class="oat-item-bottom"
        >
          <tr>
            <td>
              Qty: ${escapeHtml(quantity)}
            </td>

            <td class="oat-item-price">
              ${escapeHtml(
      money(price, currency)
    )}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function formatItemText(
  item,
  index,
  currency
) {
  const title =
    item?.productSnapshot?.title || "Item";

  const quantity = num(item?.quantity);
  const price = num(item?.price);
  const attributesText =
    extractVariantInfo(item);

  return `${index}. ${title}${attributesText
      ? ` (${attributesText})`
      : ""
    } — Qty: ${quantity} — ${money(
      price,
      currency
    )}`;
}

function infoCard(label, value) {
  return `
  <td class="oat-grid-cell">
    <div class="oat-info">
      <p class="oat-info-label">
        ${escapeHtml(label)}
      </p>

      <p class="oat-info-value">
        ${escapeHtml(value)}
      </p>
    </div>
  </td>`;
}

function summaryRow(
  label,
  value,
  strong = false
) {
  return `
  <tr class="oat-row ${strong ? "oat-total" : ""
    }">
    <td>
      ${escapeHtml(label)}
    </td>

    <td class="oat-row-value">
      ${escapeHtml(value)}
    </td>
  </tr>`;
}

function emptyCard(message) {
  return `
  <div class="oat-card">
    <p
      class="oat-copy"
      style="margin:0;"
    >
      ${escapeHtml(message)}
    </p>
  </div>`;
}

const up = (value) =>
  String(value || "").toUpperCase();

const num = (value) =>
  Number.isFinite(Number(value))
    ? Number(value)
    : 0;

const money = (value, currency) => {
  const amount = Number(value || 0);

  return currency === "INR"
    ? `₹${amount.toLocaleString("en-IN")}`
    : `${currency} ${amount.toLocaleString()}`;
};

function formatDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "LIMITED TIME";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date);
}

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character]
  );

const escapeAttr = escapeHtml;
