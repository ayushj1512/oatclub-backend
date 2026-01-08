# 📩 Miray Fashions — Batch Email Sender (Minimal) ✅

This setup sends promotional/newsletter emails to large user lists (e.g. 22,000 users) using:

✅ Node.js (ESM)  
✅ Nodemailer (SMTP)  
✅ Batch sending + throttle  
✅ Progress tracking (resume support)  
✅ Failure logging + retry failed emails  

---

## ✅ Current Folder Structure

```
nodemailer/
  └─ first/
      ├─ test-send-batches.js
      ├─ retry-failed.js
      └─ logs/
          ├─ progress.json
          ├─ sent.jsonl
          └─ failed.jsonl
```

---

## ✅ Requirements

### 1) Add `.env` in project root

Example:

```env
MAIL_USER=hello@mirayfashions.com
MAIL_PASS=xxxx xxxx xxxx xxxx
MAIL_FROM="Miray Fashions <hello@mirayfashions.com>"
```

✅ `MAIL_PASS` should be Gmail / Workspace **App Password**  
❌ Do not use normal Gmail password.

---

## ✅ Users List Setup

Your batch sender script expects a users list file such as:

📌 Example: `nodemailer/users.json`

Format:

```json
[
  { "email": "user1@gmail.com", "name": "User 1" },
  { "email": "user2@gmail.com", "name": "User 2" }
]
```

✅ Only `email` is required.

---

## ✅ Script 1: Send in Batches

📌 File: `nodemailer/first/test-send-batches.js`

This script:
✅ loads users list  
✅ sends emails in batches  
✅ saves progress (resume supported)  
✅ logs success + failures  

### Run:

```bash
node nodemailer/first/test-send-batches.js
```

---

## ✅ Resume Support

If the script stops/crashes midway, just run again:

```bash
node nodemailer/first/test-send-batches.js
```

It resumes automatically using:

📌 `nodemailer/first/logs/progress.json`

---

## ✅ Script 2: Retry Failed Emails

📌 File: `nodemailer/first/retry-failed.js`

This script:
✅ reads failed emails from:

📌 `nodemailer/first/logs/failed.jsonl`

✅ retries sending them  
✅ logs retry results separately (optional)

### Run:

```bash
node nodemailer/first/retry-failed.js
```

---

## ✅ Logs Location & Meaning

All logs are stored here:

```
nodemailer/first/logs/
```

### ✅ Files

- `progress.json`
  - Stores last successfully processed index
  - Used for resume support

- `sent.jsonl`
  - Each line is a JSON object for a successful sent email  
  - Example:
    ```json
    {"email":"a@gmail.com","time":"2026-01-08T10:00:00.000Z"}
    ```

- `failed.jsonl`
  - Each line is a JSON object for a failed email  
  - Example:
    ```json
    {"email":"a@gmail.com","time":"...","error":"SMTP 421 rate limited"}
    ```

---

## ✅ Batch Settings

Inside `test-send-batches.js` you can tune:

```js
const BATCH_SIZE = 30;   // reduce to 20 if Gmail rate limits
const DELAY_MS = 20000;  // delay between batches
```

✅ Recommended (safe):
- BATCH_SIZE: 20–50
- DELAY_MS: 15–40 seconds

---

## ✅ Notes (Deliverability)

To avoid Gmail "suspicious" / "images hidden":

✅ SPF must exist  
✅ DKIM must be enabled  
✅ DMARC should exist  
✅ Add footer + unsubscribe link  
✅ Don't send too fast (batching helps)  

---

## ✅ Done ✅

Minimal batch + retry system is ready inside:

📌 `nodemailer/first/`
