# 📲 Fast2SMS WhatsApp Integration (WhatsappConfirmationMessage)

This module integrates Fast2SMS WhatsApp APIs into the system for sending, tracking, and managing WhatsApp confirmation messages.

It is designed to work with the `WhatsappConfirmationMessage` model and provides a clean, scalable structure for messaging workflows.

---

## 🚀 Features

* Send WhatsApp template messages (order confirmation, updates)
* Send session messages (customer support / replies)
* Track message lifecycle:

  * sent
  * delivered
  * read
  * replied
  * failed
* Store full audit logs (send + webhook payloads)
* Handle inbound customer replies
* Webhook-based real-time updates
* Manual log sync fallback (last 3 days)
* IST-based timestamp consistency

---

## 📁 Folder Structure

```
fast2sms/
├── README.md
├── fast2sms.config.js      # Config & env mapping
├── fast2sms.service.js     # Base API handler
├── fast2sms.utils.js       # Helpers (phone, IST, etc.)
├── fast2sms.whatsapp.js    # WhatsApp send logic
├── fast2sms.webhook.js     # Webhook parser
├── fast2sms.logs.js        # Logs sync (fallback)
└── index.js                # Central exports
```

---

## ⚙️ Environment Variables

Add the following in your `.env`:

```
# FAST2SMS CORE
FAST2SMS_API_KEY=your_api_key_here
FAST2SMS_BASE_URL=https://www.fast2sms.com/dev

# WHATSAPP CONFIG
FAST2SMS_PHONE_NUMBER_ID=your_phone_number_id
FAST2SMS_DEFAULT_COUNTRY_CODE=91
FAST2SMS_DEFAULT_TEMPLATE_LANGUAGE=en

# WEBHOOK
FAST2SMS_WEBHOOK_SECRET=your_secret_key
FAST2SMS_WHATSAPP_WEBHOOK_URL=https://your-domain.com/api/whatsapp-confirmation-message/webhook

# TEMPLATE IDS
FAST2SMS_CONFIRMATION_TEMPLATE_ID=template_id_here
FAST2SMS_ORDER_CONFIRM_TEMPLATE_ID=template_id_here
FAST2SMS_ORDER_SHIPPED_TEMPLATE_ID=template_id_here
```

---

## 🔁 System Flow

### 1. Send Message

* Controller calls Fast2SMS API
* Template message is sent
* Response is stored in DB

Stored fields:

* `fast2smsRequestId`
* `fast2smsMessageId`
* `status = sent`
* `sentAt`
* `rawSendResponse`

---

### 2. Webhook Trigger

Fast2SMS sends webhook events to:

```
POST /api/whatsapp-confirmation-message/webhook
```

Events include:

* delivered
* read
* failed
* reply

---

### 3. Webhook Processing

Webhook updates DB:

| Event     | Field Updated     |
| --------- | ----------------- |
| delivered | deliveredAt       |
| read      | readAt            |
| failed    | failedAt + reason |
| reply     | repliedAt + text  |

Also stores:

* `rawWebhookPayload`

---

### 4. Customer Reply Handling

* Incoming message stored as:

  * `direction = incoming`
  * `status = replied`
  * `customerReplyText`

---

### 5. Logs Sync (Fallback)

If webhook misses any update:

```
POST /api/whatsapp-confirmation-message/sync-logs
```

* Fetch last 3 days logs
* Reconcile message statuses

---

## 📡 API Endpoints

```
POST   /api/whatsapp-confirmation-message/send
POST   /api/whatsapp-confirmation-message/webhook

GET    /api/whatsapp-confirmation-message
GET    /api/whatsapp-confirmation-message/order/:orderId
GET    /api/whatsapp-confirmation-message/:id

PATCH  /api/whatsapp-confirmation-message/:id/status
DELETE /api/whatsapp-confirmation-message/:id

POST   /api/whatsapp-confirmation-message/sync-logs
```

---

## 📊 Status Lifecycle

```
pending → queued → sent → delivered → read → replied
                          ↘ failed
```

---

## 🧠 Data Model (Core Fields)

Each message stores:

* customer info (name, phone)
* order linkage (`orderId`)
* template info (`templateName`, `variables`)
* provider ids (`fast2smsRequestId`, `fast2smsMessageId`)
* status lifecycle
* timestamps (IST safe)
* customer reply
* raw payloads

---

## ⏱ Time Handling (IMPORTANT)

* MongoDB stores UTC internally
* System ensures IST consistency using:

  * IST helpers
  * IST-based timestamps

This ensures:

* correct reporting
* no timezone bugs
* clean frontend rendering

---

## 🔐 Security Notes

* Always validate webhook payload
* Use `FAST2SMS_WEBHOOK_SECRET` for verification
* Avoid trusting raw payload blindly
* Log all webhook events for debugging

---

## 🧪 Testing Checklist

Before going live:

* [ ] Send test message
* [ ] Verify `sent` status
* [ ] Check webhook delivery
* [ ] Verify `delivered` update
* [ ] Verify `read` update
* [ ] Send customer reply
* [ ] Verify reply stored
* [ ] Test logs sync fallback

---

## ⚡ Best Practices

* Always normalize phone numbers
* Store raw responses (debugging lifesaver)
* Use indexes on:

  * phone
  * orderId
  * status
* Keep templates centralized
* Avoid hardcoding template IDs in controllers

---

## 📈 Future Enhancements

* Conversation-based chat UI
* Multi-message thread support
* Broadcast messaging
* Campaign tracking
* Automated triggers (order shipped, delivered)
* CRM integration

---

## 🧩 Architecture Philosophy

This module is designed to:

* Keep Fast2SMS logic isolated
* Keep controllers clean
* Allow easy provider switching (e.g. Twilio, Gupshup)
* Scale from simple notifications → full chat system

---

## ✅ Summary

This setup gives you:

✔ Reliable WhatsApp delivery
✔ Full message tracking
✔ Customer reply handling
✔ Clean architecture
✔ Easy debugging & reconciliation

---

**Ready for production 🚀**
