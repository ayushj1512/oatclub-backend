// nodemailer/retry-failed.js
import "dotenv/config";
import fs from "fs";

import { sendMail } from "./mailer.js";
import { PromoPreviewTemplate } from "./template/PromoPreviewTemplate.js";

const FAILED_FILE = "./nodemailer/logs/failed.jsonl";
const RETRY_SENT_FILE = "./nodemailer/logs/retry-sent.jsonl";
const RETRY_FAILED_FILE = "./nodemailer/logs/retry-failed.jsonl";

function logLine(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}

async function run() {
  console.log("\n🔁 Retrying failed emails...\n");

  if (!fs.existsSync(FAILED_FILE)) {
    console.log("✅ No failed file found. Nothing to retry.");
    return;
  }

  const lines = fs.readFileSync(FAILED_FILE, "utf-8").trim().split("\n");
  const failed = lines.map((l) => JSON.parse(l));

  console.log(`📌 Failed emails found: ${failed.length}\n`);

  for (const item of failed) {
    try {
      const { subject, text, html, utmUrl } = PromoPreviewTemplate({
        subject: "✨ Welcome Offer — Extra 10% OFF | MIRAY Fashions",
        utm: {
          source: "miray",
          medium: "email",
          campaign: "welcome10_retry",
          content: "promo_banner",
        },
        unsubscribeUrl: `https://mirayfashions.com/unsubscribe?email=${encodeURIComponent(item.email)}`,
      });

      await sendMail({
        to: item.email,
        subject,
        text,
        html,
      });

      logLine(RETRY_SENT_FILE, {
        email: item.email,
        time: new Date().toISOString(),
        utmUrl,
      });

      console.log(`✅ Retried OK: ${item.email}`);
    } catch (err) {
      logLine(RETRY_FAILED_FILE, {
        email: item.email,
        time: new Date().toISOString(),
        error: err.message,
      });

      console.log(`❌ Retry failed: ${item.email} → ${err.message}`);
    }
  }

  console.log("\n🎉 Retry process finished!");
}

run().catch((err) => console.error("🔥 Retry crashed:", err));
