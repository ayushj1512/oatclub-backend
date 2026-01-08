// nodemailer/test-send-batches.js
import "dotenv/config";
import fs from "fs";

import { sendMail } from "./mailer.js";
import { PromoPreviewTemplate } from "./template/PromoPreviewTemplate.js";

const USERS_FILE = "./nodemailer/users.json";
const LOG_DIR = "./nodemailer/logs";
const PROGRESS_FILE = `${LOG_DIR}/progress.json`;
const SENT_FILE = `${LOG_DIR}/sent.jsonl`;
const FAILED_FILE = `${LOG_DIR}/failed.jsonl`;

const BATCH_SIZE = 30; // ✅ safe small batch
const DELAY_MS = 20000; // ✅ 20 sec delay after each batch

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function ensureLogs() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(PROGRESS_FILE))
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ index: 0 }, null, 2));
}

function readProgress() {
  return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
}

function saveProgress(index) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ index }, null, 2));
}

function logLine(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}

async function run() {
  console.log("\n🚀 Batch Email Sender started\n");
  ensureLogs();

  const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  const { index } = readProgress();

  console.log(`📌 Total users: ${users.length}`);
  console.log(`▶️ Resuming from index: ${index}\n`);

  for (let i = index; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);

    console.log(`📦 Sending batch ${i} → ${i + batch.length - 1} (${batch.length} users)`);

    for (const user of batch) {
      try {
        const { subject, text, html, utmUrl } = PromoPreviewTemplate({
          subject: "✨ Welcome Offer — Extra 10% OFF | MIRAY Fashions",
          utm: {
            source: "miray",
            medium: "email",
            campaign: "welcome10_bulk",
            content: "promo_banner",
          },
          unsubscribeUrl: `https://mirayfashions.com/unsubscribe?email=${encodeURIComponent(user.email)}`,
        });

        await sendMail({
          to: user.email,
          subject,
          text,
          html,
        });

        logLine(SENT_FILE, { email: user.email, time: new Date().toISOString(), utmUrl });

        console.log(`✅ Sent: ${user.email}`);
      } catch (err) {
        logLine(FAILED_FILE, {
          email: user.email,
          time: new Date().toISOString(),
          error: err.message,
        });

        console.log(`❌ Failed: ${user.email} → ${err.message}`);
      }
    }

    saveProgress(i + batch.length);
    console.log(`💾 Progress saved: ${i + batch.length}`);

    console.log(`⏳ Waiting ${DELAY_MS / 1000}s before next batch...\n`);
    await sleep(DELAY_MS);
  }

  console.log("🎉 All batches processed!");
}

run().catch((err) => console.error("🔥 Batch sender crashed:", err));
