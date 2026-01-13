// nodemailer/retry-failed.js
import "dotenv/config";
import fs from "fs";

import { sendMail } from "./mailer.js";
import { PromoPreviewTemplate } from "./template/PromoPreviewTemplate.js";

const FAILED_FILE = "./nodemailer/logs/failed.jsonl";
const RETRY_SENT_FILE = "./nodemailer/logs/retry-sent.jsonl";
const RETRY_FAILED_FILE = "./nodemailer/logs/retry-failed.jsonl";

// ✅ Campaign constants (keep in sync with batch sender)
const SUBJECT_LINE = "✨ Welcome Offer — Extra 10% OFF | MIRAY Fashions";
const BASE_URL = "https://mirayfashions.com";
const HERO_IMAGE =
  "https://res.cloudinary.com/djtva6hec/image/upload/v1768074735/miray/media/e3i3buarxz7u4m56u4ru.webp";

function logLine(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}

async function run() {
  console.log("\n🔁 Retrying failed emails...\n");

  if (!fs.existsSync(FAILED_FILE)) {
    console.log("✅ No failed file found. Nothing to retry.");
    return;
  }

  const raw = fs.readFileSync(FAILED_FILE, "utf-8").trim();
  if (!raw) {
    console.log("✅ failed.jsonl is empty. Nothing to retry.");
    return;
  }

  const lines = raw.split("\n");
  const failed = lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  console.log(`📌 Failed emails found: ${failed.length}\n`);

  for (const item of failed) {
    try {
      if (!item.email) continue;

      const unsubscribeUrl = `https://mirayfashions.com/unsubscribe?email=${encodeURIComponent(
        item.email
      )}`;

      const { subject, text, html, utmUrl } = PromoPreviewTemplate({
        subject: SUBJECT_LINE,
        name: "there", // failed logs usually don’t have name
        baseUrl: BASE_URL,
        heroImage: HERO_IMAGE,
        utm: {
          source: "miray",
          medium: "email",
          campaign: "welcome10_retry",
          content: "promo_banner",
        },
        unsubscribeUrl,
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
        error: err?.message || String(err),
      });

      console.log(`❌ Retry failed: ${item.email} → ${err?.message || err}`);
    }
  }

  console.log("\n🎉 Retry process finished!");
}

run().catch((err) => console.error("🔥 Retry crashed:", err));
