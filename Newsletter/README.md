Bilkul Ayush ✅
Main aapka README **aur clean, detailed, practical** bana diya hai — **faltu lines hata di**, aur sirf wohi cheezein rakhi hain jo developer ko actually chahiye.

✅ Is updated README me:

* Exact folder structure
* Exact `.env` keys
* Script configuration (batch, delay, retries, dry-run)
* Safety rules (Gmail limits, no crash)
* Logs + output format
* Future upgrades (short)

---

# ✅ FINAL `README.md` (Improved + Minimal + Detailed)

> Paste this in: **`scripts/README.md`** (recommended)
> Ya project root pe `README_NEWSLETTER.md`

```md
# 📩 Miray Fashions — Newsletter Batch Sender (Manual Script)

This document explains how to send a **premium welcome newsletter** to all subscribers using a **manual batch script**.

✅ Node.js (ESM)  
✅ MongoDB (Mongoose)  
✅ Premium HTML Template (`newsletterWarmWelcomeTemplate`)  
✅ Batch sending + delay + retries  
✅ DB analytics update after send  

---

## ✅ Template & System

### Template file
```

nodemailer/NewsletterWelcomeTemplate.js

````

Exported function:
```js
newsletterWarmWelcomeTemplate({ name, couponCode, heroImage, ctaUrl, utm })
````

### Subscribers Model

```
Newsletter/NewsletterSubscription.js
```

Collection:

* `email`
* `analytics.totalSent`
* `lastSentAt`

---

## ✅ Script We Will Create (After Template Approval)

File:

```
scripts/sendWelcomeNewsletter.js
```

This script will:

1. Connect to MongoDB
2. Fetch all subscriber emails
3. Deduplicate emails
4. Send emails in batches (default: 50 per batch)
5. Delay between batches (default: 1 sec)
6. Retry failed emails (default: 2 retries)
7. Update analytics in MongoDB
8. Save failed recipients in a log file

✅ Script will not crash if a single email fails.

---

## ✅ Required `.env`

Make sure project root `.env` includes:

```env
MONGO_URI=your_mongodb_connection_string

MAIL_USER=hello@mirayfashions.com
MAIL_PASS=xxxx xxxx xxxx xxxx
MAIL_FROM="Miray Fashions <hello@mirayfashions.com>"
```

⚠️ `MAIL_PASS` must be an **App Password** (not Gmail password)

---

## ✅ Script Config (Editable)

Inside script, these configs will be available:

```js
const BATCH_SIZE = 50;        // safe for Gmail SMTP
const DELAY_MS = 1000;        // delay between batches
const MAX_RETRIES = 2;        // retry failed recipients
const DRY_RUN = false;        // true = send only to test emails
const TEST_EMAILS = ["yourtest@gmail.com"];
```

---

## ✅ Dry Run Mode (Testing)

Before sending to all subscribers:

1. Set:

```js
const DRY_RUN = true;
const TEST_EMAILS = ["yourtest@gmail.com"];
```

2. Run script:

```bash
node scripts/sendWelcomeNewsletter.js
```

✅ Only test emails will receive the newsletter.

---

## ✅ Production Mode

After testing:

```js
const DRY_RUN = false;
```

Run:

```bash
node scripts/sendWelcomeNewsletter.js
```

✅ Script will send to all subscriber emails in DB.

---

## ✅ What Script Logs Will Look Like

Example console output:

```
[INFO] Total subscribers: 1240
[INFO] Batch size: 50 | Delay: 1000ms
[INFO] Sending batch 1/25...
[SUCCESS] Batch 1 sent: 50
[INFO] Sending batch 2/25...
[FAILED] user@gmail.com (retry 1)
[SUCCESS] Batch 2 sent: 49
...
[SUMMARY]
Sent: 1230
Failed: 10
Retried: 8
Log saved: logs/failed-newsletter.json
```

---

## ✅ Analytics Updates

After successful sending, script will update:

* `analytics.totalSent += 1`
* `lastSentAt = Date.now()`

Only for emails that were attempted.

---

## ✅ Deliverability / Safety Notes

* Gmail SMTP will throttle if you send too fast.
* Batch + delay prevents rate-limits.
* Recommended:

  * Batch size: **50**
  * Delay: **1 sec**
  * Total/day depends on Gmail account limits

For very large lists (10k+):
✅ Move to ESP (Brevo / Mailchimp / Klaviyo)
✅ or use queue workers (BullMQ + Redis)

---

## ✅ Next Enhancements (Optional Later)

* Send to a specific `tag`
* Only active/verified users
* Campaign history storage
* Open/click tracking (via pixel + redirect)
* Auto unsubscribe enforcement

---

## ✅ Done

After template approval, we will:
✅ Create `scripts/sendWelcomeNewsletter.js`
✅ Ensure batch sending + retries + logs
✅ Keep it safe & scalable

```

---

✅ If you want, main isme ek aur section add kar dunga:

### “How to rollback / stop script safely”
- Ctrl+C safe handling
- Resume from last batch feature

---

**Now just reply:**  
✅ `approved` + batch size (50) + delay (1000ms)  

And I’ll give you **complete script file** (copy paste ready) with logs + retry + DB updates.
```
