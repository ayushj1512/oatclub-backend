// nodemailer/first/send-last-5000.js
import "dotenv/config";
import fs from "fs";

import { sendMail } from "../mailer.js";
import { PromoPreviewTemplate } from "../template/PromoPreviewTemplate.js";

const LOG_DIR = "./nodemailer/first/logs-last-5000";
const PROGRESS_FILE = `${LOG_DIR}/progress.json`;
const SENT_FILE = `${LOG_DIR}/sent.jsonl`;
const FAILED_FILE = `${LOG_DIR}/failed.jsonl`;

// ✅ Sending speed controls
const BATCH_SIZE = 60;      // tune: 40–80
const CONCURRENCY = 5;      // tune: 3–6
const DELAY_MS = 4000;      // tune: 2000–8000

// ✅ How many to send from the "end"
const TARGET_SEND = 5000;

// ✅ API settings (live)
const API_BASE = "https://error.mirayfashions.com";
const API_PATH = "/api/newsletters/subscribers";
const API_LIMIT = 200; // page size (keep stable)

// ✅ Campaign settings
const SUBJECT_LINE = "✨ Welcome Offer — Extra 10% OFF | MIRAY Fashions";
const BASE_URL = "https://mirayfashions.com";
const HERO_IMAGE =
  "https://res.cloudinary.com/djtva6hec/image/upload/v1768074735/miray/media/e3i3buarxz7u4m56u4ru.webp";

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function ensureLogs() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(PROGRESS_FILE)) {
    fs.writeFileSync(
      PROGRESS_FILE,
      JSON.stringify({ page: null, indexInPage: 0, sentCount: 0 }, null, 2)
    );
  }
  if (!fs.existsSync(SENT_FILE)) fs.writeFileSync(SENT_FILE, "");
  if (!fs.existsSync(FAILED_FILE)) fs.writeFileSync(FAILED_FILE, "");
}

function readProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  } catch {
    return { page: null, indexInPage: 0, sentCount: 0 };
  }
}

function saveProgress(page, indexInPage, sentCount) {
  fs.writeFileSync(
    PROGRESS_FILE,
    JSON.stringify({ page, indexInPage, sentCount }, null, 2)
  );
}

function logLine(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}

async function fetchSubscribers(page, limit) {
  const url = new URL(API_PATH, API_BASE);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText}: ${text}`);
  }

  const data = await res.json();
  const subscriptions = Array.isArray(data?.subscriptions) ? data.subscriptions : [];
  const total = Number(data?.total || 0);

  return { subscriptions, total };
}

function isSendable(sub) {
  if (!sub?.email) return false;
  if (sub.isActive === false) return false;
  if (sub.isSuppressed === true) return false;
  if (sub.unsubscribedAt) return false;
  return true;
}

async function sendWithConcurrency(items, concurrency, worker) {
  let idx = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const current = idx++;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}

async function run() {
  console.log("\n🚀 Sender started (LAST 5000 mode)\n");
  ensureLogs();

  let { page, indexInPage, sentCount } = readProgress();

  // Step 1: Find total + last page
  const first = await fetchSubscribers(1, 1);
  const total = first.total;
  const lastPage = Math.max(1, Math.ceil(total / API_LIMIT));

  if (!page) page = lastPage;

  console.log(`📌 Total subscribers: ${total}`);
  console.log(`📌 Last page: ${lastPage}`);
  console.log(`▶️ Resuming from page=${page}, indexInPage=${indexInPage}, sentCount=${sentCount}`);
  console.log(`🎯 Target to send: ${TARGET_SEND}\n`);

  while (page >= 1 && sentCount < TARGET_SEND) {
    const { subscriptions } = await fetchSubscribers(page, API_LIMIT);

    if (!subscriptions.length) {
      console.log(`⚠️ Page ${page} empty. Moving previous...`);
      page -= 1;
      indexInPage = 0;
      saveProgress(page, indexInPage, sentCount);
      continue;
    }

    // We want "last" users. Assuming page ordering is chronological,
    // we process current page in reverse within the page.
    const sendable = subscriptions.filter(isSendable);

    // Reverse within page to start from newest in that page
    const reversed = [...sendable].reverse();

    // Resume inside reversed list
    const remaining = reversed.slice(indexInPage);

    console.log(
      `📄 Page ${page}: fetched=${subscriptions.length}, sendable=${sendable.length}, remaining=${remaining.length}`
    );

    for (let i = 0; i < remaining.length && sentCount < TARGET_SEND; i += BATCH_SIZE) {
      const batch = remaining.slice(i, i + BATCH_SIZE);

      console.log(
        `📦 Batch (page ${page}) ${indexInPage + i} → ${indexInPage + i + batch.length - 1
        } | sentCount=${sentCount}`
      );

      await sendWithConcurrency(batch, CONCURRENCY, async (sub, localIndex) => {
        if (sentCount >= TARGET_SEND) return;

        const email = sub.email;

        try {
          const unsubscribeUrl = `https://mirayfashions.com/unsubscribe?email=${encodeURIComponent(
            email
          )}`;

          const { subject, text, html, utmUrl } = PromoPreviewTemplate({
            subject: SUBJECT_LINE,
            name: "there",
            baseUrl: BASE_URL,
            heroImage: HERO_IMAGE,
            utm: {
              source: "miray",
              medium: "email",
              campaign: "welcome10_last5000",
              content: "promo_banner",
            },
            unsubscribeUrl,
          });

          await sendMail({ to: email, subject, text, html });

          logLine(SENT_FILE, { email, time: new Date().toISOString(), utmUrl, page });
          console.log(`✅ Sent: ${email}`);
        } catch (err) {
          logLine(FAILED_FILE, {
            email,
            time: new Date().toISOString(),
            error: err?.message || String(err),
            page,
          });
          console.log(`❌ Failed: ${email} → ${err?.message || err}`);
        } finally {
          // progress after each completion
          // NOTE: this is "best effort" in parallel; still works for resume.
          indexInPage = indexInPage + i + localIndex + 1;
          sentCount += 1;
          saveProgress(page, indexInPage, sentCount);
        }
      });

      console.log(`💾 Progress saved: page=${page}, indexInPage=${indexInPage}, sentCount=${sentCount}`);
      if (sentCount >= TARGET_SEND) break;

      console.log(`⏳ Waiting ${DELAY_MS / 1000}s...\n`);
      await sleep(DELAY_MS);
    }

    // Move to previous page (newer -> older)
    page -= 1;
    indexInPage = 0;
    saveProgress(page, indexInPage, sentCount);
    console.log(`⬅️ Moving to previous page: ${page}\n`);
  }

  console.log("\n🎉 Done!");
  console.log(`✅ Total sent in this run (including failed attempts): ${sentCount}`);
}

run().catch((err) => console.error("🔥 Sender crashed:", err));
