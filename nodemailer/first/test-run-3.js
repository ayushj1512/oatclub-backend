// nodemailer/first/test-run-3.js
import "dotenv/config";
import { sendMail } from "../mailer.js";
import { PromoPreviewTemplate } from "../template/PromoPreviewTemplate.js";

const SUBJECT_LINE = "✨ Welcome Offer — Extra 10% OFF | MIRAY Fashions";
const BASE_URL = "https://mirayfashions.com";
const HERO_IMAGE =
  "https://res.cloudinary.com/djtva6hec/image/upload/v1768074735/miray/media/e3i3buarxz7u4m56u4ru.webp";

const TEST_USERS = [
  { email: "miray.ayushjuneja@gmail.com", name: "Ayush Juneja" },
  { email: "ayushjuneja999@gmail.com", name: "Ayush Juneja" },
  { email: "ayushjuneja996@gmail.com", name: "Ayush Juneja" },
];

async function run() {
  console.log("\n🧪 Sending TEST emails (3 users)...\n");

  for (const user of TEST_USERS) {
    const unsubscribeUrl = `https://mirayfashions.com/unsubscribe?email=${encodeURIComponent(
      user.email
    )}`;

    const { subject, text, html, utmUrl } = PromoPreviewTemplate({
      subject: SUBJECT_LINE,
      name: user.name,
      baseUrl: BASE_URL,
      heroImage: HERO_IMAGE,
      utm: {
        source: "miray",
        medium: "email",
        campaign: "welcome10_test",
        content: "promo_banner",
      },
      unsubscribeUrl,
    });

    try {
      await sendMail({ to: user.email, subject, text, html });
      console.log(`✅ Sent: ${user.email} | ${utmUrl}`);
    } catch (err) {
      console.log(`❌ Failed: ${user.email} → ${err?.message || err}`);
    }
  }

  console.log("\n🎉 Test finished!\n");
}

run().catch((err) => console.error("🔥 Test crashed:", err));
