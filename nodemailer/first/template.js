// nodemailer/first/template.js

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildUnsubscribeLink(email, baseUrl) {
  const encoded = encodeURIComponent(email || "");
  return `${baseUrl}&email=${encoded}`;
}

export function renderHtmlTemplate({
  name,
  subject,
  ctaUrl,
  heroImage,
  unsubscribeUrl,
}) {
  const safeName = escapeHtml(name?.trim() || "there");
  const safeSubject = escapeHtml(subject);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${safeSubject}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;">
    <!-- Preheader -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${safeSubject}
    </div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:24px 0;">
      <tr>
        <td align="center" style="padding:0 16px;">
          <table role="presentation" width="720" cellspacing="0" cellpadding="0"
            style="width:100%;max-width:720px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 25px rgba(0,0,0,.08);">

            <!-- HERO IMAGE -->
            <tr>
              <td style="padding:0;margin:0;">
                <a href="${ctaUrl}" target="_blank" style="display:block;text-decoration:none;">
                  <img src="${heroImage}" alt="Miray Fashions Promo" width="720"
                    style="display:block;width:100%;height:auto;border:0;outline:none;text-decoration:none;" />
                </a>
              </td>
            </tr>

            <!-- CONTENT -->
            <tr>
              <td style="padding:20px 22px 8px 22px;font-family:Arial,Helvetica,sans-serif;">
                <div style="font-size:14px;color:#111827;line-height:1.6;">
                  <div style="font-size:16px;font-weight:700;margin-bottom:10px;">
                    Hi ${safeName} 👋
                  </div>

                  <div style="margin-bottom:12px;color:#374151;">
                    Your update from <b>Miray Fashions</b> is here:
                  </div>

                  <!-- Subject Highlight -->
                  <div style="display:inline-block;background:#111827;color:#ffffff;padding:10px 12px;border-radius:999px;font-size:13px;font-weight:700;letter-spacing:.2px;">
                    ${safeSubject}
                  </div>

                  <div style="margin-top:16px;color:#6b7280;font-size:13px;">
                    Tap the banner above to explore the latest collection & offers.
                  </div>
                </div>
              </td>
            </tr>

            <!-- FOOTER -->
            <tr>
              <td style="padding:14px 22px 22px 22px;font-family:Arial,Helvetica,sans-serif;">
                <div style="font-size:12px;color:#6b7280;line-height:1.6;text-align:center;">
                  Having trouble viewing this email?
                  <a href="${ctaUrl}" target="_blank" style="color:#111827;text-decoration:underline;font-weight:700;">
                    Open in browser
                  </a>
                  <br/><br/>
                  If you don’t want to receive these emails,
                  <a href="${unsubscribeUrl}" target="_blank" style="color:#111827;text-decoration:underline;font-weight:700;">
                    Unsubscribe
                  </a>
                  <br/>
                  <span style="color:#9ca3af;">© ${new Date().getFullYear()} Miray Fashions</span>
                </div>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderTextTemplate({ name, subject, ctaUrl, unsubscribeUrl }) {
  const n = name?.trim() || "there";
  return `Hi ${n},

${subject}

Open: ${ctaUrl}

If you don't want these emails: ${unsubscribeUrl}

— Miray Fashions`;
}
