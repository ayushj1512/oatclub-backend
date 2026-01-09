// nodemailer/UserOnboardingTemplate.js

export function userOnboardingTemplate({
  name = "",
  ctaUrl = "#",
  brandName = "Miray Fashions",
  supportEmail = "support@mirayfashions.com",
}) {
  // ✅ Sanitize name strongly
  const safeName = String(name || "")
    .trim()
    .replace(/\s+/g, " "); // remove extra spaces like "Ayush   Juneja"

  // ✅ If name missing, use friendly fallback
  const displayName = safeName.length ? safeName : "there";

  // ✅ Safe brand/support formatting
  const safeBrandName = String(brandName || "Miray Fashions").trim();
  const safeSupportEmail = String(supportEmail || "support@mirayfashions.com")
    .trim()
    .toLowerCase();

  const subject = `Welcome to ${safeBrandName} ✨`;

  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");

  // ✅ Plain text fallback
  const text = `Hi ${displayName},

Welcome to ${safeBrandName} ✨

Thank you for creating an account with us — we’re genuinely delighted to have you here.

Your account is now ready. You can:
• Explore our latest collections
• Track your orders anytime
• Save your details for faster checkout

${hasValidCta ? `Get Started: ${ctaUrl}\n` : ""}

Need help? Reply to this email or contact us at ${safeSupportEmail}.

With regards,
Team ${safeBrandName}
`;

  const html = `
  <div style="background:#ffffff;color:#000000;padding:40px 20px;">
    <div style="max-width:680px;margin:0 auto;border:1px solid rgba(0,0,0,0.10);border-radius:30px;overflow:hidden;background:#ffffff;font-family:Poppins, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">

      <!-- Header -->
      <div style="padding:48px 40px 28px 40px;text-align:center;">
        <img
          src="https://res.cloudinary.com/djtva6hec/image/upload/v1764916639/miray/media/k0yvgu5m0ij1husm3ugh.png"
          alt="${escapeHtml(safeBrandName)} Logo"
          style="height:56px;width:auto;display:block;margin:0 auto;"
        />

        <div style="margin-top:26px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.45em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            Welcome
          </p>

          <h1 style="margin:14px 0 0 0;font-size:20px;letter-spacing:0.18em;font-weight:600;text-transform:uppercase;">
            Your account is ready
          </h1>
        </div>

        <div style="margin:28px auto 0 auto;height:1px;width:90px;background:rgba(0,0,0,0.20);"></div>
      </div>

      <!-- Body -->
      <div style="padding:0 40px 48px 40px;">

        <!-- Greeting -->
        <h2 style="margin:0;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
          Hi ${escapeHtml(displayName)} ✨
        </h2>

        <p style="margin:10px 0 0 0;font-size:13px;line-height:22px;color:rgba(0,0,0,0.65);">
          Thank you for creating an account with
          <span style="font-weight:600;color:#000000;">${escapeHtml(safeBrandName)}</span>.
          We’re genuinely delighted to welcome you.
        </p>

        <!-- Highlight Card -->
        <div style="margin-top:26px;border:1px solid rgba(0,0,0,0.10);border-radius:16px;padding:20px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.35em;color:rgba(0,0,0,0.55);text-transform:uppercase;">
            What you can do now
          </p>

          <div style="margin-top:14px;">
            ${featureRow("Explore our latest collections", "Discover new arrivals and timeless favourites.")}
            ${featureRow("Track your orders easily", "Check order updates anytime from your account.")}
            ${featureRow("Faster checkout", "Save your details for a smooth shopping experience.")}
          </div>
        </div>

        <!-- CTA -->
        ${
          hasValidCta
            ? `<div style="margin-top:34px;text-align:center;">
                <a
                  href="${escapeAttr(ctaUrl)}"
                  style="display:inline-block;border:1px solid #000000;border-radius:9999px;padding:12px 34px;font-size:13px;font-weight:600;letter-spacing:0.03em;color:#000000;text-decoration:none;"
                >
                  Get Started
                </a>

                <p style="margin:14px 0 0 0;font-size:11px;letter-spacing:0.03em;color:rgba(0,0,0,0.50);line-height:18px;">
                  If the button does not work, copy and paste this link into your browser:<br/>
                  <span style="color:rgba(0,0,0,0.75);">${escapeHtml(ctaUrl)}</span>
                </p>
              </div>`
            : ""
        }

        <!-- Support -->
        <div style="margin-top:34px;">
          <div style="height:1px;width:64px;background:rgba(0,0,0,0.20);"></div>

          <p style="margin:18px 0 0 0;font-size:13px;line-height:22px;color:rgba(0,0,0,0.65);">
            Need assistance? Simply reply to this email or reach out at
            <a href="mailto:${escapeAttr(safeSupportEmail)}"
               style="font-weight:600;color:#000000;text-decoration:none;">
              ${escapeHtml(safeSupportEmail)}
            </a>.
            We’ll be happy to help you.
          </p>

          <p style="margin:18px 0 0 0;font-size:15px;line-height:26px;color:rgba(0,0,0,0.80);">
            With regards,<br/>
            <span style="font-weight:600;color:#000000;">Team ${escapeHtml(safeBrandName)}</span>
          </p>
        </div>

      </div>

      <!-- Footer -->
      <div style="padding:26px 40px;border-top:1px solid rgba(0,0,0,0.10);">
        <p style="margin:0;font-size:11px;line-height:20px;color:rgba(0,0,0,0.55);">
          This is an automated message. You may reply to this email for any assistance.
        </p>
      </div>

    </div>
  </div>
  `;

  return { subject, text, html };
}

/* ------------------------- Helpers ------------------------- */

function featureRow(title, desc) {
  return `
    <div style="display:flex;gap:12px;margin:0 0 14px 0;">
      <div style="height:10px;width:10px;margin-top:6px;border-radius:999px;background:rgba(0,0,0,0.25);"></div>
      <div>
        <p style="margin:0;font-size:13px;font-weight:600;color:#000000;">
          ${escapeHtml(title)}
        </p>
        <p style="margin:6px 0 0 0;font-size:12px;line-height:18px;color:rgba(0,0,0,0.60);">
          ${escapeHtml(desc)}
        </p>
      </div>
    </div>
  `;
}

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
