// nodemailer/test-newsletter-welcome.js
import "dotenv/config";

import { sendMail } from "./mailer.js";
import { newsletterWarmWelcomeTemplate } from "./template/NewsletterWelcomeTemplate.js";

async function runNewsletterWelcomeTest() {
  console.log("\n🚀 Sending Newsletter Welcome Template Test...\n");

  const recipients = [
    "miray.ayushjuneja@gmail.com",
    "mr.creativeabhiii@gmail.com"
  ];

  const { subject, text, html } = newsletterWarmWelcomeTemplate({
    name: "Ayush",
    couponCode: "WELCOME10",

    // CTA + Links
    ctaUrl: "https://mirayfashions.com/",
    heroLink: "https://mirayfashions.com/product-category/featured/",

    // Unsubscribe (placeholder)
    unsubscribeUrl: "https://mirayfashions.com/unsubscribe?email=test",
  });

  await sendMail({
    to: recipients,
    subject,
    text,
    html,
  });

  console.log("✅ Newsletter Welcome email sent to:", recipients.join(", "));
}

runNewsletterWelcomeTest().catch((err) => {
  console.error("❌ Newsletter Welcome Test failed:", err);
});
