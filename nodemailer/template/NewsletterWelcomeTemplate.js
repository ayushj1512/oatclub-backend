// nodemailer/NewsletterWelcomeTemplate.js

export function newsletterWarmWelcomeTemplate({
  // Coupon
  couponCode = "WELCOME10",
  couponLine = "Use it at checkout to unlock your welcome offer.",
  couponNote = "Valid for limited time • One per customer",

  // CTA
  ctaText = "Shop Miray Fashions",
  ctaUrl = "https://mirayfashions.com/",

  // Branding
  logoImage =
    "https://res.cloudinary.com/djtva6hec/image/upload/v1764916639/miray/media/k0yvgu5m0ij1husm3ugh.png",

  // Hero Image (16:9 Premium)
  heroImage =
    "https://res.cloudinary.com/djtva6hec/image/upload/v1767337429/miray/media/dmckngbehal6dmc6ajwe.png",
  heroAlt = "Miray Collection",
  heroLink = "https://mirayfashions.com/product-category/featured/",

  // UTM Tracking
  utm = {
    source: "newsletter",
    medium: "email",
    campaign: "welcome",
    content: "warm_welcome",
  },

  // Footer + Unsubscribe
  supportEmail = "hello@mirayfashions.com",
  unsubscribeUrl = "#",
}) {
  const subject = `Welcome to Miray Fashions — Your Coupon Inside 🖤`;

  const withUtm = (url, contentOverride) =>
    addUtm(url, {
      ...utm,
      content: contentOverride || utm?.content,
    });

  const heroTracked = withUtm(heroLink || ctaUrl, "hero_image");
  const ctaTracked = withUtm(ctaUrl, "main_cta");
  const unsubTracked = withUtm(unsubscribeUrl, "unsubscribe");

  // ✅ Text fallback (NO NAME)
  const text = `Welcome to Miray Fashions ✨

Premium black & white drops, limited collections, made to elevate your wardrobe.

Your Welcome Coupon: ${couponCode}
${couponLine}
${couponNote}

Shop now:
${ctaTracked}

Support: ${supportEmail}
Unsubscribe: ${unsubTracked}

With regards,
Team Miray Fashions
`;

  // ✅ HTML (NO NAME)
  const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Miray Newsletter Welcome Preview</title>
  </head>

  <body style="margin:0;padding:0;background:#f6f6f6;">
    <div style="background:#f6f6f6;color:#000000;padding:34px 14px;">
      <div
        style="
          max-width:640px;
          margin:0 auto;
          border:1px solid rgba(0,0,0,0.10);
          border-radius:28px;
          overflow:hidden;
          background:#ffffff;
          font-family:Poppins, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          box-shadow:0 10px 28px rgba(0,0,0,0.08);
        "
      >
        <!-- Header -->
        <div style="padding:38px 30px 18px 30px;text-align:center;">
          <img
            src="${escapeAttr(logoImage)}"
            alt="Miray Fashions Logo"
            style="height:52px;width:auto;display:block;margin:0 auto;"
          />

          <p
            style="
              margin:16px 0 0 0;
              font-size:10px;
              letter-spacing:0.48em;
              color:rgba(0,0,0,0.55);
              text-transform:uppercase;
            "
          >
            Welcome
          </p>

          <div style="margin:18px auto 0 auto;height:1px;width:72px;background:rgba(0,0,0,0.18);"></div>
        </div>

        <!-- HERO IMAGE (16:9 Premium) -->
        <div style="padding:0 30px 6px 30px;">
          <a
            href="${escapeAttr(heroTracked)}"
            style="text-decoration:none;display:block;"
          >
            <div
              style="
                width:100%;
                aspect-ratio:16/9;
                background:#f1f1f1;
                border-radius:20px;
                overflow:hidden;
                border:1px solid rgba(0,0,0,0.10);
                box-shadow:0 8px 18px rgba(0,0,0,0.10);
              "
            >
              <img
                src="${escapeAttr(heroImage)}"
                alt="${escapeAttr(heroAlt)}"
                style="
                  width:100%;
                  height:100%;
                  object-fit:cover;
                  display:block;
                "
              />
            </div>
          </a>
        </div>

        <!-- Body -->
        <div style="padding:22px 30px 34px 30px;">
          <!-- Heading -->
          <h2 style="margin:0;font-size:19px;font-weight:600;letter-spacing:-0.02em;">
            Welcome to Miray Fashions ✨
          </h2>

          <p
            style="
              margin:10px 0 0 0;
              font-size:13px;
              color:rgba(0,0,0,0.62);
              line-height:22px;
            "
          >
            Premium black & white drops, limited collections, made to elevate your wardrobe.
          </p>

          <!-- COUPON -->
          <div
            style="
              margin-top:18px;
              border:1px solid rgba(0,0,0,0.10);
              border-radius:18px;
              padding:16px 16px;
              background:rgba(0,0,0,0.02);
            "
          >
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
              <div style="flex:1;min-width:220px;">
                <p
                  style="
                    margin:0;
                    font-size:10px;
                    letter-spacing:0.30em;
                    color:rgba(0,0,0,0.55);
                    text-transform:uppercase;
                  "
                >
                  Your Welcome Coupon
                </p>
                <p style="margin:10px 0 0 0;font-size:13px;color:rgba(0,0,0,0.78);line-height:20px;">
                  ${escapeHtml(couponLine)}
                </p>
                <p style="margin:8px 0 0 0;font-size:11px;color:rgba(0,0,0,0.45);line-height:16px;">
                  ${escapeHtml(couponNote)}
                </p>
              </div>

              <div
                style="
                  border:1px dashed rgba(0,0,0,0.35);
                  border-radius:9999px;
                  padding:10px 18px;
                  background:#ffffff;
                  white-space:nowrap;
                "
              >
                <span
                  style="
                    font-size:13px;
                    letter-spacing:0.14em;
                    font-weight:700;
                    text-transform:uppercase;
                  "
                >
                  ${escapeHtml(couponCode)}
                </span>
              </div>
            </div>
          </div>

          <!-- CTA -->
          <div style="margin-top:20px;text-align:center;">
            <a
              href="${escapeAttr(ctaTracked)}"
              style="
                display:inline-block;
                background:#000000;
                color:#ffffff;
                border-radius:9999px;
                padding:13px 30px;
                font-size:13px;
                font-weight:600;
                letter-spacing:0.03em;
                text-decoration:none;
                box-shadow:0 10px 18px rgba(0,0,0,0.18);
              "
            >
              ${escapeHtml(ctaText)}
            </a>

            <p
              style="
                margin:14px 0 0 0;
                font-size:11px;
                letter-spacing:0.02em;
                color:rgba(0,0,0,0.45);
                line-height:16px;
              "
            >
              Apply coupon <span style="font-weight:700;color:#000000;">${escapeHtml(
                couponCode
              )}</span> at checkout.
            </p>
          </div>

          <!-- Signature -->
          <div style="margin-top:28px;">
            <div style="height:1px;width:58px;background:rgba(0,0,0,0.18);"></div>
            <p style="margin:16px 0 0 0;font-size:14px;line-height:24px;color:rgba(0,0,0,0.80);">
              With regards,<br />
              <span style="font-weight:600;color:#000000;">Team Miray Fashions</span>
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div style="padding:18px 30px;border-top:1px solid rgba(0,0,0,0.10);background:#fbfbfb;">
          <p style="margin:0;font-size:11px;line-height:18px;color:rgba(0,0,0,0.55);">
            You are receiving this because you subscribed to Miray Fashions.<br />
            Need help? Reply to this email or contact us at
            <a href="mailto:${escapeAttr(
              supportEmail
            )}" style="color:#000000;text-decoration:none;font-weight:600;">
              ${escapeHtml(supportEmail)}
            </a>.
          </p>

          <p style="margin:10px 0 0 0;font-size:11px;line-height:18px;color:rgba(0,0,0,0.55);">
            <a href="${escapeAttr(
              unsubTracked
            )}" style="color:rgba(0,0,0,0.65);text-decoration:underline;">Unsubscribe</a>
          </p>
        </div>
      </div>
    </div>
  </body>
</html>
`;

  return { subject, text, html };
}

/* ------------------------- UTM Helper ------------------------- */

function addUtm(url, utm = {}) {
  try {
    const u = new URL(url);
    if (utm?.source) u.searchParams.set("utm_source", utm.source);
    if (utm?.medium) u.searchParams.set("utm_medium", utm.medium);
    if (utm?.campaign) u.searchParams.set("utm_campaign", utm.campaign);
    if (utm?.content) u.searchParams.set("utm_content", utm.content);
    return u.toString();
  } catch {
    return url;
  }
}

/* ------------------------- Security ------------------------- */

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
