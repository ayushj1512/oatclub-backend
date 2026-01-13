// nodemailer/first/test-send-batches.js
import "dotenv/config";
import fs from "fs";

import { sendMail } from "../mailer.js";
import { PromoPreviewTemplate } from "../template/PromoPreviewTemplate.js";

const LOG_DIR = "./nodemailer/first/logs";
const PROGRESS_FILE = `${LOG_DIR}/progress.json`;
const SENT_FILE = `${LOG_DIR}/sent.jsonl`;
const FAILED_FILE = `${LOG_DIR}/failed.jsonl`;
const LOCK_FILE = `${LOG_DIR}/send.lock`;

// ✅ SPEED (tuned for “faster but still safe”)
const BATCH_SIZE = 60;
const CONCURRENCY = 5;
const DELAY_MS = 4000;

// ✅ Force start point
const FORCE_START_AT = 300; // start from indexInPage=300 (0-based in sendable list)
const FORCE_ON_EVERY_RUN = false; // ✅ recommended: don't reset to 300 on every run

// ✅ Error backoff ladder (minutes) for TEMP errors only
const BACKOFF_MINUTES = [2, 3, 5];

// ✅ API settings (live)
const API_BASE = "https://error.mirayfashions.com";
const API_PATH = "/api/newsletters/subscribers";
const API_LIMIT = 200;

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
      JSON.stringify({ page: 1, indexInPage: 0 }, null, 2)
    );
  }
  if (!fs.existsSync(SENT_FILE)) fs.writeFileSync(SENT_FILE, "");
  if (!fs.existsSync(FAILED_FILE)) fs.writeFileSync(FAILED_FILE, "");
}

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    console.log(
      "🚫 Sender already running (lock exists). If not, delete logs/send.lock"
    );
    process.exit(0);
  }
  fs.writeFileSync(LOCK_FILE, String(Date.now()));

  const cleanup = () => {
    try {
      if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
    } catch {}
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
}

function readProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  } catch {
    return { page: 1, indexInPage: 0 };
  }
}

function saveProgress(page, indexInPage) {
  fs.writeFileSync(
    PROGRESS_FILE,
    JSON.stringify({ page, indexInPage }, null, 2)
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
  const subscriptions = Array.isArray(data?.subscriptions)
    ? data.subscriptions
    : [];
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

// ✅ Simple concurrency helper
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

// ✅ Detect DAILY hard limits (do NOT retry with minutes)
function isDailyLimit(err) {
  const msg = String(err?.message || err || "");
  const resp = String(err?.response || "");

  // Gmail user limit
  if (/Daily user sending limit exceeded/i.test(msg)) return true;
  if (/Daily user sending limit exceeded/i.test(resp)) return true;

  // Workspace SMTP relay user limit (your latest error)
  if (/Daily SMTP relay limit exceeded for user/i.test(msg)) return true;
  if (/Daily SMTP relay limit exceeded for user/i.test(resp)) return true;

  // Help links that appear in the SMTP response
  if (msg.includes("6140680#userlimit") || resp.includes("6140680#userlimit"))
    return true;

  // Fallback: generic daily quota error code seen in your logs
  if (msg.includes("550-5.4.5") || resp.includes("550-5.4.5")) return true;

  return false;
}

// ✅ Identify retryable SMTP / network issues (TEMP)
function isRetryableError(err) {
  const msg = String(err?.message || err || "");
  const code = err?.code;

  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "EAI_AGAIN")
    return true;

  // any 4xx temp errors (but not daily limit 550)
  if (/\b4\d\d\b/.test(msg)) return true;

  if (/too many/i.test(msg)) return true;
  if (/rate/i.test(msg) && /limit/i.test(msg)) return true;
  if (/try again/i.test(msg)) return true;
  if (/temporarily/i.test(msg)) return true;

  return false;
}

// ✅ retry wrapper with exponential backoff for per-email send (TEMP only)
async function sendWithRetry(fn, { attempts = 3, baseDelay = 1500 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      if (i === attempts || !isRetryableError(err) || isDailyLimit(err)) throw err;
      const wait = baseDelay * Math.pow(2, i - 1);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// ✅ Batch-level backoff ladder: 2m → 3m → 5m (TEMP only)
async function runBatchWithBackoff(doBatchWork) {
  let lastErr = null;

  for (let attempt = 0; attempt <= BACKOFF_MINUTES.length; attempt++) {
    try {
      if (attempt > 0) {
        const mins = BACKOFF_MINUTES[attempt - 1];
        console.log(`🕒 Cooling down for ${mins} minute(s) then retrying batch...`);
        await sleep(mins * 60 * 1000);
      }

      await doBatchWork();
      return; // success
    } catch (err) {
      lastErr = err;

      // ✅ daily hard limit: stop immediately (no ladder)
      if (isDailyLimit(err)) {
        console.log(
          "🛑 Daily sending limit hit (Gmail/Relay). Stopping now. Resume after quota resets (rolling 24h)."
        );
        throw err;
      }

      if (!isRetryableError(err)) {
        // non-retryable -> don't do ladder
        throw err;
      }

      if (attempt === BACKOFF_MINUTES.length) {
        console.log(
          `❌ Batch failed even after backoff ladder (${BACKOFF_MINUTES.join("m → ")}m). Stopping.`
        );
        throw err;
      }

      console.log(
        `⚠️ Batch error (retryable): ${err?.message || err} (will backoff & retry)`
      );
    }
  }

  throw lastErr;
}

async function run() {
  console.log("\n🚀 Batch Email Sender started (API mode)\n");
  ensureLogs();
  acquireLock();

  let { page, indexInPage } = readProgress();

  // ✅ Force start from 300 (one-time-ish)
  if (FORCE_ON_EVERY_RUN) {
    page = 1;
    indexInPage = FORCE_START_AT;
    saveProgress(page, indexInPage);
  } else if (page === 1 && indexInPage < FORCE_START_AT) {
    indexInPage = FORCE_START_AT;
    saveProgress(page, indexInPage);
  }

  console.log(`▶️ Starting from page: ${page}, indexInPage: ${indexInPage}\n`);

  while (true) {
    const { subscriptions, total } = await fetchSubscribers(page, API_LIMIT);

    if (!subscriptions.length) {
      console.log("✅ No more subscribers returned by API. Done.");
      break;
    }

    const sendable = subscriptions.filter(isSendable);

    console.log(
      `📄 Page ${page} fetched: ${subscriptions.length} subscribers | sendable: ${sendable.length} | total: ${total}`
    );

    const remaining = sendable.slice(indexInPage);

    for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
      const batch = remaining.slice(i, i + BATCH_SIZE);
      const batchBaseIndex = indexInPage + i;

      console.log(
        `📦 Sending batch (page ${page}) ${batchBaseIndex} → ${
          batchBaseIndex + batch.length - 1
        } (${batch.length} users) | concurrency=${CONCURRENCY}`
      );

      try {
        await runBatchWithBackoff(async () => {
          // ✅ Concurrency-safe progress tracker (prevents skipping)
          const done = new Array(batch.length).fill(false);
          let progressPointer = batchBaseIndex;

          const tryAdvanceAndSave = () => {
            while (
              progressPointer < batchBaseIndex + batch.length &&
              done[progressPointer - batchBaseIndex] === true
            ) {
              progressPointer++;
            }
            saveProgress(page, progressPointer);
          };

          let firstRetryableBatchError = null;

          await sendWithConcurrency(batch, CONCURRENCY, async (sub, localIndex) => {
            const email = sub.email;
            const absoluteIndex = batchBaseIndex + localIndex;

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
                  campaign: "welcome10_bulk",
                  content: "promo_banner",
                },
                unsubscribeUrl,
              });

              const headers = { "List-Unsubscribe": `<${unsubscribeUrl}>` };

              await sendWithRetry(
                async () => {
                  await sendMail({ to: email, subject, text, html, headers });
                },
                { attempts: 3, baseDelay: 1500 }
              );

              logLine(SENT_FILE, {
                email,
                time: new Date().toISOString(),
                utmUrl,
                page,
                indexInPage: absoluteIndex,
              });
              console.log(`✅ Sent: ${email}`);
            } catch (err) {
              if (isDailyLimit(err)) throw err;

              logLine(FAILED_FILE, {
                email,
                time: new Date().toISOString(),
                page,
                indexInPage: absoluteIndex,
                error: err?.message || String(err),
              });
              console.log(`❌ Failed: ${email} → ${err?.message || err}`);

              if (isRetryableError(err) && !firstRetryableBatchError) {
                firstRetryableBatchError = err;
              }
            } finally {
              done[localIndex] = true;
              tryAdvanceAndSave();
            }
          });

          if (firstRetryableBatchError) throw firstRetryableBatchError;

          console.log(
            `💾 Progress saved: page=${page}, indexInPage=${batchBaseIndex + batch.length}`
          );
        });
      } catch (err) {
        // ✅ Daily limit: stop cleanly (no crash)
        if (isDailyLimit(err)) {
          console.log(
            "✅ Progress already saved. Exiting cleanly due to daily quota. Run again after quota resets."
          );
          process.exit(0);
        }
        throw err;
      }

      console.log(`⏳ Waiting ${DELAY_MS / 1000}s before next batch...\n`);
      await sleep(DELAY_MS);
    }

    page += 1;
    indexInPage = 0;
    saveProgress(page, indexInPage);
    console.log(`➡️ Moving to next page: ${page}\n`);
  }

  console.log("🎉 All batches processed!");
}

run().catch((err) => console.error("🔥 Batch sender crashed:", err));