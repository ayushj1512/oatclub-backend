// nodemailer/OrderTrackingTemplate.js

export function orderTrackingTemplate({
  name = "Customer",
  awb = "—",
  courierName = "—",
  trackingLink = "#",
  order = {},
}) {
  const orderId = order?.orderId || order?.orderNumber || order?._id || "—";
  const hasValidLink = Boolean(trackingLink && trackingLink !== "#");

  const subject = `Your order is on the way — Tracking details #${orderId} 📦`;

  // ✅ Text fallback
  const text = `Hi ${name},

Your shipment is now in transit. Here are your tracking details:

Order ID: ${orderId}
Courier: ${courierName}
AWB: ${awb}
${hasValidLink ? `Track Here: ${trackingLink}` : ""}

With regards,
Team Miray Fashions
`;

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
            Order Tracking
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
          Your order is on the way. You can track it anytime using the details below.
        </p>

        <!-- Tracking Details Card -->
        <div style="margin-top:28px;border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:20px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.35em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            Tracking Details
          </p>

          <div style="margin-top:14px;">
            ${infoRow("Courier", courierName)}
            ${infoRow("AWB", awb)}
            ${
              hasValidLink
                ? infoRowLink("Tracking Link", trackingLink)
                : infoRow("Tracking Link", "Will be available soon")
            }
          </div>

          ${
            hasValidLink
              ? `<div style="margin-top:18px;text-align:center;">
                  <a
                    href="${escapeAttr(trackingLink)}"
                    style="display:inline-block;border:1px solid #000000;border-radius:9999px;padding:12px 32px;font-size:13px;font-weight:600;letter-spacing:0.03em;color:#000000;text-decoration:none;"
                  >
                    Track Your Order
                  </a>
                  <p style="margin:12px 0 0 0;font-size:11px;letter-spacing:0.03em;color:rgba(0,0,0,0.45);">
                    If the button doesn’t work, copy & open the tracking link above.
                  </p>
                </div>`
              : ""
          }
        </div>

        <!-- Note -->
        <div style="margin-top:22px;">
          <p style="margin:0;font-size:12px;line-height:20px;color:rgba(0,0,0,0.55);">
            Updates may take a few hours to reflect on the courier tracking page after dispatch.
          </p>
        </div>

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

function infoRow(label, value) {
  return `
    <div style="display:flex;justify-content:space-between;gap:14px;font-size:13px;color:rgba(0,0,0,0.75);line-height:22px;margin:0 0 10px 0;">
      <span style="min-width:120px;">${escapeHtml(label)}</span>
      <span style="font-weight:600;color:#000;word-break:break-word;text-align:right;">
        ${escapeHtml(value)}
      </span>
    </div>
  `;
}

function infoRowLink(label, link) {
  return `
    <div style="display:flex;justify-content:space-between;gap:14px;font-size:13px;color:rgba(0,0,0,0.75);line-height:22px;margin:0 0 10px 0;">
      <span style="min-width:120px;">${escapeHtml(label)}</span>
      <a href="${escapeAttr(link)}" style="font-weight:600;color:#000;text-decoration:underline;word-break:break-word;text-align:right;">
        ${escapeHtml(link)}
      </a>
    </div>
  `;
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
