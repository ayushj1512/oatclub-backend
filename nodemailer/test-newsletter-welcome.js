// nodemailer/test-promo-preview.js
import "dotenv/config";

import { sendMail } from "./mailer.js";
import { PromoPreviewTemplate } from "./template/PromoPreviewTemplate.js";

async function runPromoPreviewTest() {
  console.log("\n🚀 Sending Promo Preview Template Test...\n");

  const recipients = [
    "miray.ayushjuneja@gmail.com",
    // "mr.creativeabhiii@gmail.com",
  ];

  const { subject, text, html, utmUrl } = PromoPreviewTemplate({
    subject: "✨ Welcome Offer — Extra 10% OFF | MIRAY Fashions",

    baseUrl: "https://mirayfashions.com",
    imageUrl:
      "https://res.cloudinary.com/djtva6hec/image/upload/v1767863578/miray/media/dr06bw6oqa511xr2dsve.jpg",

    utm: {
      source: "miray",
      medium: "email",
      campaign: "welcome10_offer_test",
      content: "promo_banner",
    },
  });

  console.log("🔗 UTM Tracking URL:", utmUrl);

  await sendMail({
    to: recipients,
    subject,
    text,
    html,
  });

  console.log("✅ Promo Preview email sent to:", recipients.join(", "));
}

runPromoPreviewTest().catch((err) => {
  console.error("❌ Promo Preview Test failed:", err);
});
