<!-- # 📩 Miray Fashions — Nodemailer + EventBus Email System (Premium Templates)

This folder contains a **minimal, clean, event-driven email system** for Miray Fashions using:

✅ Node.js (ESM)  
✅ Nodemailer (SMTP via Gmail / Workspace)  
✅ EventEmitter-based EventBus  
✅ Premium black & white HTML templates (email-safe inline CSS)  
✅ Customer + Admin/Finance email flows  

---

## ✅ Folder Structure

```
nodemailer/
  ├─ emailHandlers.js
  ├─ eventBus.js
  ├─ mailer.js
  ├─ OrderConfirmationTemplate.js
  ├─ OnboardingEmailTempalte.js
  ├─ OrderReceivedTemplate.js
  ├─ RmaEmailTemplate.js
  ├─ test.js
```

---

## ✅ Setup Requirements

### 1) Add `.env` in project root
Example:

```env
MAIL_USER=hello@mirayfashions.com
MAIL_PASS=xxxx xxxx xxxx xxxx  # Gmail / Workspace App Password
MAIL_FROM="Miray Fashions <hello@mirayfashions.com>"
```

✅ `MAIL_PASS` should be your **App Password** (not Gmail normal password)

---

## ✅ 1) mailer.js

Responsible for sending actual emails via SMTP using Nodemailer.

```js
sendMail({ to, subject, text, html })
```

✅ Supports `to` as:
- string: `"user@gmail.com"`
- array: `["o","admin@mirayfashions.com"]`

---

## ✅ 2) eventBus.js

Event system that triggers email flows.

### EVENTS used:

| Event Name | Purpose |
|----------|---------|
| USER_REGISTERED | Customer onboarding email |
| ORDER_CONFIRMED | Customer order confirmation email |
| ORDER_RECEIVED | Finance/Admin order received email |
| RMA_REQUESTED | Customer RMA request received email |

✅ You emit events from controllers (User/Order/RMA controllers).

---

## ✅ 3) Templates (HTML + Text)

### ✅ Customer Templates

✅ `OnboardingEmailTempalte.js`  
- Used on user registration
- Premium onboarding look

✅ `OrderConfirmationTemplate.js`  
- Used when order is successfully created

✅ `RmaEmailTemplate.js`  
- Used when customer creates RMA
- Supports return / exchange + fee info

---

### ✅ Stakeholder Templates

✅ `OrderReceivedTemplate.js`  
- Used when new order is received
- Sent ONLY to:

```js
oatclub.in@gmail.com
admin@mirayfashions.com
```

---

## ✅ 4) emailHandlers.js (Main Wiring)

This file:
✅ imports templates  
✅ listens to events  
✅ sends the correct email  

### Fixed stakeholder recipients:

```js
const ORDER_RECEIVED_RECIPIENTS = [
  "oatclub.in@gmail.com",
  "admin@mirayfashions.com",
];
```

---

## ✅ How to use from Controllers

### ✅ User Controller (Registration success)

```js
import { EVENTS, eventBus } from "../nodemailer/eventBus.js";

eventBus.emit(EVENTS.USER_REGISTERED, {
  email: user.email,
  name: user.name,
});
```

---

### ✅ Order Controller (Order Created)

```js
import { EVENTS, eventBus } from "../nodemailer/eventBus.js";

eventBus.emit(EVENTS.ORDER_CONFIRMED, {
  email: customer.email,
  name: customer.name,
  order: finalOrder,
});

eventBus.emit(EVENTS.ORDER_RECEIVED, {
  order: finalOrder,
});
```

---

### ✅ RMA Controller (RMA Created)

```js
import { EVENTS, eventBus } from "../nodemailer/eventBus.js";

eventBus.emit(EVENTS.RMA_REQUESTED, {
  email: customer.email,
  name: customer.name,
  order,
  rma: created,
  policy: RMA_POLICY,
});
```

---

## ✅ Testing Emails

### Run:

```bash
node nodemailer/test.js
```

This triggers:
✅ onboarding email  
✅ order confirmation email  
✅ finance/admin order received email  
✅ rma created email  

---

## ✅ Notes / Best Practices

### ✅ 1) Avoid sending 10,000 emails directly from Node
For 10,000+ emails, always use:
- queue system (BullMQ / Redis)
- background workers

✅ Our templates + events are ready for queue-based integration.

---

### ✅ 2) Email Client Compatibility
Tailwind classes do NOT work in real emails.

✅ All templates are inline CSS and email-safe.

---

### ✅ 3) Logging
You will see logs like:

✅ `ORDER_CONFIRMED email sent to...`  
✅ `ORDER_RECEIVED email sent to finance + admin...`

---

## ✅ Future Add-ons (Optional)
If needed later:
✅ RMA Status Update Template (pickup scheduled, picked, shipped, closed)  
✅ Order Shipped / Delivered templates  
✅ OTP / Login emails  
✅ Queue system integration (BullMQ)

---

## ✅ Done ✅
This folder is now a complete event-based email system for:
🖤 Customer onboarding  
🛒 Order confirmation  
📌 Admin/finance order notification  
♻️ RMA request emails   -->
