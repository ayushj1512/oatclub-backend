// nodemailer/events/UserOnboardingEmailTempalte.js

export function userOnboardingTemplate({
  name = "",
  ctaUrl = "#",
  brandName = "Miray Fashions",
  supportEmail = "support@mirayfashions.com",
}) {
  const safeName = String(name || "").trim().replace(/\s+/g, " ");
  const displayName = safeName.length ? safeName : "there";

  const safeBrandName = String(brandName || "Miray Fashions").trim();
  const safeSupportEmail = String(
    supportEmail || "support@mirayfashions.com"
  )
    .trim()
    .toLowerCase();

  const subject = `Welcome to ${safeBrandName} ✨`;
  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");

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
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />

<style>
:root{
  color-scheme:light dark;
  supported-color-schemes:light dark;
}

@media (prefers-color-scheme: dark){
  body,.miray-bg{background:#0f0f10!important;}
  .miray-shell{background:#151517!important;border-color:rgba(255,255,255,.08)!important;}
  .miray-card{background:#1b1b1d!important;border-color:rgba(255,255,255,.08)!important;}
  .miray-text{color:#e4e4e7!important;}
  .miray-muted{color:#b4b4b8!important;}
  .miray-title,.miray-strong{color:#ffffff!important;}
  .miray-divider{background:rgba(255,255,255,.08)!important;}
  .miray-btn{background:#ffffff!important;color:#111111!important;border-color:#ffffff!important;}
  .miray-link{color:#ffffff!important;}
  .miray-dot{background:#ffffff!important;}
  .miray-header{background:linear-gradient(180deg,#18181b 0%,#0f0f10 100%)!important;}
  .miray-header p,.miray-header span,.miray-header div{color:#e4e4e7!important;}
  .miray-header h1,.miray-header b{color:#ffffff!important;}
  .miray-footer{border-color:rgba(255,255,255,.08)!important;}
}

[data-ogsc] .miray-bg{background:#0f0f10!important;}
[data-ogsc] .miray-shell{background:#151517!important;}
[data-ogsc] .miray-card{background:#1b1b1d!important;}
[data-ogsc] .miray-text{color:#e4e4e7!important;}
[data-ogsc] .miray-muted{color:#b4b4b8!important;}
[data-ogsc] .miray-title,[data-ogsc] .miray-strong{color:#ffffff!important;}
[data-ogsc] .miray-link{color:#ffffff!important;}
[data-ogsc] .miray-dot{background:#ffffff!important;}
[data-ogsc] .miray-header{background:linear-gradient(180deg,#18181b 0%,#0f0f10 100%)!important;}
[data-ogsc] .miray-header p,[data-ogsc] .miray-header span,[data-ogsc] .miray-header div{color:#e4e4e7!important;}
[data-ogsc] .miray-header h1,[data-ogsc] .miray-header b{color:#ffffff!important;}
[data-ogsc] .miray-footer{border-color:rgba(255,255,255,.08)!important;}
</style>
</head>

<body style="margin:0;padding:0;background:#ffffff;">
<div class="miray-bg" style="padding:40px 20px;background:#ffffff;">

<div class="miray-shell" style="max-width:680px;margin:auto;background:#ffffff;border:1px solid rgba(0,0,0,.08);border-radius:28px;overflow:hidden;font-family:Poppins,Arial,sans-serif;">

<div class="miray-header" style="padding:48px 40px 30px;text-align:center;background:linear-gradient(180deg,#18181b 0%,#0f0f10 100%);">
  <img
    src="https://res.cloudinary.com/djtva6hec/image/upload/v1778268933/miray/media/zvliktr4z5zboetdz76k.png"
    alt="${escapeAttr(safeBrandName)}"
    style="height:56px;max-width:100%;"
  />

  <p style="margin:24px 0 8px;font-size:11px;letter-spacing:.42em;text-transform:uppercase;color:#d4d4d8;">
    Welcome
  </p>

  <h1 style="margin:0;font-size:18px;letter-spacing:.14em;color:#ffffff;font-weight:700;text-transform:uppercase;">
    Your account is ready
  </h1>

  <p style="margin:12px 0 0;font-size:13px;color:#e4e4e7;line-height:1.6;">
    Welcome to <b style="color:#ffffff;">${escapeHtml(safeBrandName)}</b>
  </p>
</div>

<div style="padding:36px 40px 44px;">

<h2 class="miray-title" style="margin:0 0 10px;font-size:24px;color:#111111;">
  Hi ${escapeHtml(displayName)} ✨
</h2>

<p class="miray-text" style="margin:0 0 26px;font-size:14px;line-height:1.8;color:#555555;">
  Thank you for creating an account with
  <b class="miray-strong">${escapeHtml(safeBrandName)}</b>.
  We’re genuinely delighted to welcome you.
</p>

<div class="miray-card" style="${cardBoxStyle}">
  <p class="miray-muted" style="${sectionTitleStyle}">What you can do now</p>

  <div style="margin-top:14px;">
    ${featureRow(
      "Explore our latest collections",
      "Discover new arrivals and timeless favourites."
    )}
    ${featureRow(
      "Track your orders easily",
      "Check order updates anytime from your account."
    )}
    ${featureRow(
      "Faster checkout",
      "Save your details for a smooth shopping experience."
    )}
  </div>
</div>

${
  hasValidCta
    ? `
<div style="margin-top:30px;text-align:center;">
  <a href="${escapeAttr(ctaUrl)}" class="miray-btn" style="display:inline-block;padding:15px 28px;border-radius:999px;background:#111111;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border:1px solid #111111;">
    Get Started
  </a>

  <p class="miray-muted" style="margin:12px 0 0;font-size:11px;line-height:1.7;color:#777777;">
    If the button does not work, copy and paste this link into your browser:<br/>
    <span class="miray-text" style="color:#555555;word-break:break-word;">
      ${escapeHtml(ctaUrl)}
    </span>
  </p>
</div>`
    : ""
}

<div class="miray-card" style="margin-top:34px;padding:18px;border-radius:18px;background:#faf7f8;border:1px solid rgba(0,0,0,.05);">
  <p class="miray-text" style="margin:0;font-size:13px;line-height:1.8;color:#555555;">
    Need assistance? Reply to this email or contact us at
    <a href="mailto:${escapeAttr(safeSupportEmail)}" class="miray-link" style="font-weight:700;color:#111111;text-decoration:none;">
      ${escapeHtml(safeSupportEmail)}
    </a>.
  </p>
</div>

<p class="miray-text" style="margin-top:34px;font-size:14px;line-height:1.8;color:#444444;">
  With regards,<br />
  <b class="miray-strong">Team ${escapeHtml(safeBrandName)}</b>
</p>

</div>

<div class="miray-footer" style="padding:24px 40px;border-top:1px solid rgba(0,0,0,.08);">
  <p class="miray-muted" style="margin:0;font-size:11px;line-height:1.8;color:#777777;">
    This is an automated message. You may reply to this email for any assistance.
  </p>
</div>

</div>
</div>
</body>
</html>
`;

  return { subject, text, html };
}

/* ---------------- HELPERS ---------------- */

function featureRow(title, desc) {
  return `
  <div style="display:flex;gap:12px;margin:0 0 16px;">
    <div class="miray-dot" style="height:10px;width:10px;margin-top:6px;border-radius:999px;background:rgba(0,0,0,.25);"></div>

    <div style="flex:1;">
      <p class="miray-title" style="margin:0;font-size:13px;font-weight:700;color:#111111;">
        ${escapeHtml(title)}
      </p>
      <p class="miray-muted" style="margin:6px 0 0;font-size:12px;line-height:1.6;color:#666666;">
        ${escapeHtml(desc)}
      </p>
    </div>
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

function escapeAttr(str) {
  return escapeHtml(str);
}

const sectionTitleStyle =
  "margin:0 0 12px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#777777;";

const cardBoxStyle =
  "border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:18px;background:#fcfcfc;";