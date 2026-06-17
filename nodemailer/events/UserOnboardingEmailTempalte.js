// nodemailer/events/UserOnboardingEmailTemplate.js

export function userOnboardingTemplate({
  name = "",
  ctaUrl = "#",
  brandName = "OATCLUB",
  supportEmail = "support@oatclub.in",
}) {
  const safeName = String(name || "").trim().replace(/\s+/g, " ");
  const displayName = safeName.length ? safeName : "there";

  const safeBrandName = "OATCLUB";
  const safeSupportEmail = String(supportEmail || "support@oatclub.in")
    .trim()
    .toLowerCase();

  const subject = `Welcome to OATCLUB`;
  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");

  const text = `Hi ${displayName},

Welcome to OATCLUB.

Thank you for creating an account with us. Your OATCLUB space is ready.

You can now:
- Explore our latest collections
- Track your orders anytime
- Save your details for faster checkout

${hasValidCta ? `Get Started: ${ctaUrl}\n` : ""}

Need help? Reply to this email or contact us at ${safeSupportEmail}.

With regards,
Team OATCLUB
`;

  const html = `
<!doctype html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />

<style>
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap");

body{
  margin:0;
  padding:0;
  background:#ffffff;
  color:#111111;
  font-family:Inter,Arial,sans-serif;
  text-transform:uppercase;
}

.oat-bg{
  padding:34px 14px;
  background:#ffffff;
}

.oat-shell{
  max-width:680px;
  margin:0 auto;
  background:#ffffff;
  border:1px solid #111111;
}

.oat-top{
  background:#111111;
  color:#ffffff;
  text-align:center;
  padding:10px 18px;
  font-size:10px;
  font-weight:900;
  letter-spacing:.24em;
}

.oat-header{
  padding:30px 26px 26px;
  text-align:center;
  border-bottom:1px solid #111111;
}

.oat-logo{
  width:112px;
  max-width:160px;
  height:auto;
  object-fit:contain;
}

.oat-kicker{
  margin:20px 0 8px;
  font-size:10px;
  font-weight:900;
  letter-spacing:.26em;
  color:#111111;
}

.oat-title{
  margin:0;
  font-size:28px;
  line-height:1.08;
  font-weight:900;
  letter-spacing:-.04em;
  color:#111111;
}

.oat-subtitle{
  margin:12px 0 0;
  font-size:13px;
  line-height:1.7;
  color:#555555;
}

.oat-body{
  padding:30px 26px 34px;
}

.oat-greeting{
  margin:0;
  font-size:24px;
  line-height:1.15;
  font-weight:900;
  letter-spacing:-.03em;
  color:#111111;
}

.oat-copy{
  margin:14px 0 0;
  font-size:14px;
  line-height:1.85;
  color:#444444;
}

.oat-section{
  margin-top:28px;
}

.oat-section-title{
  margin:0 0 12px;
  font-size:10px;
  font-weight:900;
  letter-spacing:.2em;
  color:#111111;
}

.oat-card{
  border:1px solid #111111;
  background:#ffffff;
  padding:18px;
}

.oat-feature{
  display:flex;
  gap:12px;
  margin:0 0 16px;
}

.oat-feature:last-child{
  margin-bottom:0;
}

.oat-dot{
  width:9px;
  height:9px;
  min-width:9px;
  margin-top:7px;
  background:#111111;
}

.oat-feature-title{
  margin:0;
  font-size:13px;
  font-weight:900;
  color:#111111;
}

.oat-feature-desc{
  margin:6px 0 0;
  font-size:12px;
  line-height:1.6;
  color:#666666;
}

.oat-btn-wrap{
  margin-top:30px;
  text-align:center;
}

.oat-btn{
  display:inline-block;
  background:#111111;
  color:#ffffff !important;
  text-decoration:none;
  padding:15px 24px;
  font-size:11px;
  font-weight:900;
  letter-spacing:.16em;
}

.oat-note{
  margin:12px 0 0;
  font-size:11px;
  color:#666666;
  line-height:1.8;
}

.oat-link{
  color:#111111 !important;
  font-weight:900;
  text-decoration:underline;
  word-break:break-word;
}

.oat-note-card{
  margin-top:34px;
  border:1px solid #111111;
  background:#fafafa;
  padding:18px;
}

.oat-footer{
  padding:20px 26px;
  background:#111111;
  color:#ffffff;
  text-align:center;
}

.oat-footer p{
  margin:0;
  font-size:10px;
  line-height:1.8;
  font-weight:700;
  letter-spacing:.16em;
  color:#ffffff;
}

@media only screen and (max-width:620px){
  .oat-bg{
    padding:12px 7px;
  }

  .oat-header,
  .oat-body{
    padding-left:18px;
    padding-right:18px;
  }

  .oat-title{
    font-size:24px;
  }

  .oat-greeting{
    font-size:22px;
  }
}
</style>
</head>

<body>
<div class="oat-bg">
  <div class="oat-shell">

    <div class="oat-top">
      OATCLUB / OWN ALL TRENDS
    </div>

    <div class="oat-header">
      <img
        class="oat-logo"
        src="https://res.cloudinary.com/dpsvrt4sd/image/upload/v1780338447/qavpt44lsxsy3wrvuwi8.png"
        alt="OATCLUB"
      />

      <p class="oat-kicker">WELCOME</p>
      <h1 class="oat-title">Your Account Is Ready</h1>

      <p class="oat-subtitle">
        Welcome To:
        <b>${escapeHtml(safeBrandName)}</b>
      </p>
    </div>

    <div class="oat-body">

      <h2 class="oat-greeting">Hi ${escapeHtml(displayName)},</h2>

      <p class="oat-copy">
        Thank you for creating an account with <b>OATCLUB</b>. Your space is ready for orders, saved details, and faster checkout.
      </p>

      <div class="oat-section">
        <p class="oat-section-title">What You Can Do Now</p>

        <div class="oat-card">
          ${featureRow(
            "Explore Latest Collections",
            "Discover new arrivals and fresh edits."
          )}
          ${featureRow(
            "Track Orders Anytime",
            "Check order updates from your account."
          )}
          ${featureRow(
            "Faster Checkout",
            "Save your details for a smoother shopping experience."
          )}
        </div>
      </div>

      ${
        hasValidCta
          ? `
      <div class="oat-btn-wrap">
        <a href="${escapeAttr(ctaUrl)}" class="oat-btn">
          Get Started →
        </a>

        <p class="oat-note">
          If the button does not work, copy and paste this link into your browser:<br/>
          ${escapeHtml(ctaUrl)}
        </p>
      </div>`
          : ""
      }

      <div class="oat-note-card">
        <p class="oat-copy" style="margin:0;">
          Need assistance? Reply to this email or contact us at
          <a href="mailto:${escapeAttr(safeSupportEmail)}" class="oat-link">
            ${escapeHtml(safeSupportEmail)}
          </a>.
        </p>
      </div>

      <p class="oat-copy" style="margin-top:34px;">
        With regards,<br/>
        <b>Team OATCLUB</b>
      </p>

    </div>

    <div class="oat-footer">
      <p>OATCLUB • OWN ALL TRENDS • SUPPORT@OATCLUB.IN</p>
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
  <div class="oat-feature">
    <div class="oat-dot"></div>

    <div style="flex:1;">
      <p class="oat-feature-title">${escapeHtml(title)}</p>
      <p class="oat-feature-desc">${escapeHtml(desc)}</p>
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