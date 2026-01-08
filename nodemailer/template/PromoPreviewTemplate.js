// PromoPreviewTemplate.js
// ✅ Tailwind HTML Preview Template (Browser Preview / Admin Panel Preview)
// NOTE: Tailwind CDN emails me kaam nahi karta — ye preview ke liye hai.

export const PromoPreviewTemplate = ({
  subject = "✨ Welcome Offer — Extra 10% OFF | MIRAY Fashions",
  baseUrl = "https://mirayfashions.com",
  imageUrl = "https://res.cloudinary.com/djtva6hec/image/upload/v1767863578/miray/media/dr06bw6oqa511xr2dsve.jpg",

  // ✅ Unsubscribe URL
  unsubscribeUrl = "https://mirayfashions.com/unsubscribe?email=test",

  // ✅ Footer Info
  footer = {
    phone: "(+91) 7303491206",
    address:
      "TA-97-A, Gali No.-2, Tuglakabad Extension, New Delhi-110019",
    supportEmail: "support@mirayfashions.com",
  },

  // UTM Defaults
  utm = {
    source: "miray",
    medium: "email",
    campaign: "welcome10_offer",
    content: "promo_banner",
  },
} = {}) => {
  const utmUrl =
    `${baseUrl}?utm_source=${encodeURIComponent(utm.source)}` +
    `&utm_medium=${encodeURIComponent(utm.medium)}` +
    `&utm_campaign=${encodeURIComponent(utm.campaign)}` +
    `&utm_content=${encodeURIComponent(utm.content)}`;

  const text = `
MIRAY Fashions — Welcome Offer 🎉
Shop now: ${utmUrl}

Support: ${footer.supportEmail}
Phone: ${footer.phone}
Address: ${footer.address}

Unsubscribe: ${unsubscribeUrl}
`.trim();

  // ✅ Tailwind HTML Preview (includes Tailwind CDN)
  const html = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${subject}</title>

    <!-- ✅ Tailwind CDN (Preview Only) -->
    <script src="https://cdn.tailwindcss.com"></script>
  </head>

  <body class="bg-gray-100 flex items-center justify-center min-h-screen p-6">
    <!-- Email Wrapper -->
    <div class="w-full max-w-[720px] bg-white shadow-xl rounded-xl overflow-hidden">
      
      <!-- Clickable Promo Image -->
      <a href="${utmUrl}" target="_blank" class="block">
        <img
          src="${imageUrl}"
          alt="Miray Fashions Promo"
          class="w-full h-auto block"
        />
      </a>

      <!-- Minimal Footer -->
      <div class="px-6 py-5 text-center text-xs text-gray-500 space-y-2">
        <div>
          <span class="font-semibold text-gray-700">Support:</span>
          <a href="mailto:${footer.supportEmail}" class="text-black underline font-medium">
            ${footer.supportEmail}
          </a>
        </div>

        <div>
          <span class="font-semibold text-gray-700">Phone:</span> ${footer.phone}
        </div>

        <div class="leading-relaxed">
          <span class="font-semibold text-gray-700">Address:</span>
          ${footer.address}
        </div>

        <div class="pt-2">
          <a
            href="${unsubscribeUrl}"
            target="_blank"
            class="text-black underline font-medium"
          >
            Unsubscribe
          </a>
        </div>

        <div class="pt-3 text-[11px] text-gray-400">
          © ${new Date().getFullYear()} Miray Fashions. All rights reserved.
        </div>
      </div>
    </div>
  </body>
</html>
`.trim();

  return {
    subject,
    text,
    html,
    utmUrl,
  };
};
