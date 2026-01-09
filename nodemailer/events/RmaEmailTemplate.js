// nodemailer/RmaEmailTemplate.js

export function rmaCreatedTemplate({
  name = "Customer",
  order = {},
  rma = {},
  policy = { windowDays: 7 },
  ctaUrl = "#",
}) {
  const orderNumber = order?.orderNumber || order?.orderId || order?._id || "—";
  const rmaNumber = rma?.rmaNumber || "—";
  const type = String(rma?.type || "return").toUpperCase();
  const status = String(rma?.status || "requested").toUpperCase();
  const reason = String(rma?.reason || "other");
  const customerNote = String(rma?.customerNote || "");
  const windowDays = Number(policy?.windowDays || 7);

  // ✅ FIX: name fallback from shipping snapshot
  const shipping = order?.shippingAddressSnapshot || {};
  const shippingName =
    shipping?.fullName ||
    shipping?.name ||
    [shipping?.firstName, shipping?.lastName].filter(Boolean).join(" ") ||
    "";

  const finalName = String(shippingName || name || "Customer").trim();

  const feeAmount = num(rma?.fee?.amount);
  const feeCurrency = String(rma?.fee?.currency || "INR");
  const feeStatus = String(
    rma?.fee?.status || (feeAmount > 0 ? "unpaid" : "waived")
  ).toUpperCase();

  const items = Array.isArray(rma?.items) ? rma.items : [];

  // ✅ Better subject (order number also)
  const subject = `RMA Request Received — ${type} | RMA#${rmaNumber} | Order #${orderNumber}`;

  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");

  // ✅ Plain text fallback
  const text = `Hi ${finalName},

Thank you — we’ve received your request and our team will assist you shortly.

RMA Number: ${rmaNumber}
Order: ${orderNumber}
Type: ${type}
Status: ${status}
${type === "EXCHANGE" ? `Exchange Fee: ${money(feeAmount, feeCurrency)} (${feeStatus})\n` : ""}

Items:
${items.map((it, i) => formatRmaItemText(it, i + 1)).join("\n") || "—"}

Reason: ${reason}
${customerNote ? `Customer Note: ${customerNote}\n` : ""}

What happens next?
- Our team will review your request within 24 hours.
- If approved, we will schedule a pickup from your address.
- You will receive updates on this email.

${hasValidCta ? `View RMA Details: ${ctaUrl}\n` : ""}

With regards,
Team Miray Fashions
`;

  const itemsHtml = items.length
    ? items.map((it) => renderRmaItemRow(it)).join("")
    : `<div style="border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:16px;">
        <p style="margin:0;font-size:13px;color:rgba(0,0,0,0.75);">No items found.</p>
      </div>`;

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
            RMA Request Received
          </p>
          <h1 style="margin:12px 0 0 0;font-size:17px;letter-spacing:0.18em;font-weight:600;text-transform:uppercase;">
            RMA# ${escapeHtml(rmaNumber)}
          </h1>
        </div>

        <div style="margin:32px auto 0 auto;height:1px;width:80px;background:rgba(0,0,0,0.20);"></div>
      </div>

      <!-- Body -->
      <div style="padding:0 40px 48px 40px;">

        <!-- Greeting -->
        <h2 style="margin:0;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
          Hi ${escapeHtml(finalName)} ✨
        </h2>
        <p style="margin:8px 0 0 0;font-size:13px;color:rgba(0,0,0,0.60);">
          Thank you — we’ve received your request and our team will assist you shortly.
        </p>

        <!-- Compact status row -->
        <div style="margin-top:28px;">
          <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;">
            <tr>
              ${statusCard("Order", `#${orderNumber}`, "Delivered")}
              ${statusCard("Type", type, status)}
              ${
                type === "EXCHANGE"
                  ? statusCard("Fee", money(feeAmount, feeCurrency), feeStatus)
                  : statusCard("Window", `${windowDays} Days`, "Eligible")
              }
            </tr>
          </table>
        </div>

        <!-- Items -->
        <div style="margin-top:36px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.35em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            Items in this request
          </p>

          <div style="margin-top:16px;">
            ${itemsHtml}
          </div>
        </div>

        <!-- Reason -->
        <div style="margin-top:40px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.35em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            Reason
          </p>

          <div style="margin-top:16px;border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:20px;">
            <p style="margin:0;font-size:13px;color:rgba(0,0,0,0.85);font-weight:600;">
              ${escapeHtml(titleCase(reason))}
            </p>
            ${
              customerNote
                ? `<p style="margin:10px 0 0 0;font-size:13px;line-height:22px;color:rgba(0,0,0,0.70);">
                     Customer Note: “${escapeHtml(customerNote)}”
                   </p>`
                : ""
            }
          </div>
        </div>

        <!-- Next steps -->
        <div style="margin-top:40px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.35em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            What happens next?
          </p>

          <div style="margin-top:16px;border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:20px;">
            <p style="margin:0;font-size:13px;line-height:22px;color:rgba(0,0,0,0.80);">
              • Our team will review your request within <span style="font-weight:600;">24 hours</span>.<br/>
              • If approved, we will schedule a pickup from your address.<br/>
              • You will receive updates on this email.
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
                  View RMA Details
                </a>
                <p style="margin:12px 0 0 0;font-size:11px;letter-spacing:0.03em;color:rgba(0,0,0,0.45);">
                  Tracking will be available once pickup is scheduled.
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

function renderRmaItemRow(it) {
  const title = it?.title || "Item";
  const code = it?.productCode ? `Product Code: ${it.productCode}` : "";
  const sku = it?.variantSku ? `Variant SKU: ${it.variantSku}` : "";
  const qty = num(it?.quantity);

  const meta = [code, sku].filter(Boolean).join(" • ");

  return `
    <div style="border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:16px;margin:0 0 12px 0;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div style="flex:1;">
          <p style="margin:0;font-size:14px;font-weight:600;color:#000000;">
            ${escapeHtml(title)}
          </p>
          ${
            meta
              ? `<p style="margin:6px 0 0 0;font-size:12px;color:rgba(0,0,0,0.60);">${escapeHtml(meta)}</p>`
              : ""
          }
        </div>
        <div style="text-align:right;">
          <p style="margin:0;font-size:12px;color:rgba(0,0,0,0.60);">Qty</p>
          <p style="margin:4px 0 0 0;font-size:14px;font-weight:600;color:#000000;">${escapeHtml(qty)}</p>
        </div>
      </div>
    </div>
  `;
}

function formatRmaItemText(it, idx) {
  const title = it?.title || "Item";
  const qty = num(it?.quantity);
  const code = it?.productCode ? `Code: ${it.productCode}` : "";
  const sku = it?.variantSku ? `SKU: ${it.variantSku}` : "";
  const meta = [code, sku].filter(Boolean).join(" | ");
  return `${idx}. ${title} — Qty: ${qty}${meta ? ` — ${meta}` : ""}`;
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
