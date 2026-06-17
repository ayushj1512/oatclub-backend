# Shiprocket Auto-Booking + Tracking  — Handover README

> Status as of **2026-01-06**  
> Goal: Automatically create Shiprocket shipment when an order is created, save `shipment_id`, and later update AWB/tracking via **assign AWB** and/or **webhook**.

---

## ✅ What we achieved (Implemented)

### 1) Shiprocket Auth fixed (403 forbidden resolved)
- Shiprocket required **API User** creation from dashboard.
- `/auth/login` works with **API user email/password** (not the main account email).
- Token is generated successfully and used in `Authorization: Bearer <token>` header.

✅ Result: Serviceability + Create Shipment APIs now work.

---

### 2) Auto Shiprocket booking runs **after** order is created
Inside `createOrder`, after Mongo transaction completes:

```js
const freshOrder = await Order.findById(req.__createdOrder._id);
await autoBookShiprocketForOrder(freshOrder);
```

✅ Correct because external API calls should not run inside MongoDB transaction.

---

### 3) Pickup location mismatch fixed
Shiprocket rejected shipment creation with:

> Wrong Pickup location entered

✅ Fix: Use pickup_location = `"Home"` (or store in env).

Suggested env:

```env
SHIPROCKET_PICKUP_LOCATION=Home
SHIPROCKET_PICKUP_PINCODE=110019
```

Payload now correctly sends `"Home"` and shipment gets created.

---

### 4) Shipment creation now returns `shipment_id`
Shiprocket `/orders/create/adhoc` returns:

- `shipment_id` ✅
- `order_id` ✅
- `awb_code` is often empty initially ❗

✅ New logic saves shipment snapshot even if AWB is missing:
- `order.shipment.shiprocket.shipmentId`
- `order.shipment.shiprocket.orderId`
- status = `processing`

---

### 5) AWB assignment support added
When `awb_code` is missing, we optionally call:

`POST /courier/assign/awb`

Helper added: `assignAwb(shipmentId)`

✅ If AWB returned → saved in:
- `order.shipment.shiprocket.awb`
- `order.trackingDetails.trackingId`

If not returned → we rely on **panel/manual assign** + webhook later.

---

### 6) Webhook made robust (important)
Webhook now:
- Does NOT require AWB to process (early events can have shipment_id only)
- Finds order by:
  - `awb` OR
  - `shipment_id` OR
  - `channel_order_id / order_id` (orderNumber)

✅ This ensures order updates correctly when AWB comes later.

---

## ✅ Current working flow (COD + Prepaid)

### COD Order
1) Order created
2) `autoBookShiprocketForOrder` runs
3) Serviceability check
4) `createShipment(payload)` → returns shipment_id
5) Save shipment snapshot
6) Assign AWB attempt (optional)
7) Webhook later updates tracking/status

### Prepaid (Razorpay)
- Guard in autoBook:
  - If `paymentMethod === "razorpay"` and `paymentStatus !== "paid"` → skip
- After payment verified (webhook / verify handler), call:
  - `autoBookShiprocketForOrder(order)`

---

## 🔧 Key Files / Modules

### Shiprocket
- `shiprocket.auth.js` — token generation
- `shiprocket.serviceability.js` — courier check
- `shiprocket.order.js` — create shipment (adhoc)
- `shiprocket.payload.js` — payload builder (pickup_location fix)
- `shiprocket.awb.js` — ✅ assign AWB helper
- `shiprocket.webhook.js` — ✅ webhook status updates
- `shiprocket/index.js` — exports:
  - `checkServiceability`
  - `createShipment`
  - `assignAwb`

### Orders
- `Orders.controller.js` (createOrder + auto booking + tracking update)
- `shipping.controller.js` (manual booking & reverse pickup)

### Routes
- `/api/shiprocket/webhook` — webhook endpoint
- `/api/orders/:id/ship` — manual book shipment
- `/api/shiprocket/reverse/:orderId/:rmaNumber` — reverse pickup

---

## ✅ ENV variables required

```env
# Shiprocket API User credentials
SHIPROCKET_EMAIL=api-user-email@domain.com
SHIPROCKET_PASSWORD=api-user-password

# Pickup configuration
SHIPROCKET_PICKUP_LOCATION=Home
SHIPROCKET_PICKUP_PINCODE=110019

# Optional (only if you want to use token verification in webhook)
SHIPROCKET_WEBHOOK_TOKEN=some-secret
```

---

## ✅ Testing checklist (Must Do)

### A) Shipment creation test
1. Create COD order
2. Confirm logs:
   - ✅ serviceability success
   - ✅ createShipment response includes shipment_id
3. Confirm order in DB contains:
   - `shipment.provider = "shiprocket"`
   - `shipment.shiprocket.shipmentId = "<id>"`

### B) AWB assignment test
- If `assignAwb` is enabled:
  - Check logs: `✅ AWB assigned & saved`
- If not assigned:
  - Assign courier from Shiprocket panel → webhook should update DB

### C) Webhook test
- Use Shiprocket dashboard “Test Webhook” button
- Confirm server receives payload and updates DB
- Ensure webhook always returns 200

---

## ⚠️ Security Notes (Important)
- Never paste Shiprocket token or password in logs/chat.
- Rotate token/password if leaked.
- Webhook should optionally validate `x-api-key` token.

---

## 🚧 Remaining tasks (To-Do)

### 1) Production webhook migration
- Shiprocket dashboard supports only one webhook URL.
- Since old site still needed:
  - keep old URL for now
  - later migrate / forward webhook payload to new backend

### 2) Prepaid (Razorpay) finalize
- Ensure on payment verification:
  - set `order.paymentStatus = "paid"`
  - call `autoBookShiprocketForOrder(order)`
- Add retry logic if Shiprocket temporarily fails.

### 3) Courier selection improvement (optional)
- Currently: serviceability is only used to verify availability
- Future:
  - choose cheapest/fastest courier from list
  - pass courier_company_id to assign AWB

### 4) Add cron fallback (optional)
- If webhook misses:
  - run a cron to fetch shipment details for orders where:
    - shipmentId exists but awb missing

---

## ✅ Quick reference endpoints

- Serviceability  
  `GET /courier/serviceability/?pickup_postcode=...&delivery_postcode=...&weight=...&cod=...`

- Create Shipment  
  `POST /orders/create/adhoc`

- Assign AWB  
  `POST /courier/assign/awb`  
  Body: `{ "shipment_id": 1116119764 }`

- Webhook  
  `POST /api/shiprocket/webhook`

---

## ✅ Support: Common errors

### Wrong pickup location
- Fix `pickup_location` to exact value from Shiprocket pickup list.

### AWB not returned
- Normal behavior for adhoc creation
- Call assign AWB OR rely on panel + webhook.

### Webhook not firing
- Ensure:
  - public HTTPS URL
  - POST method
  - server accessible
  - body parser enabled
  - Shiprocket dashboard has webhook enabled

---

## 📌 Next thing to implement (recommended)
✅ After payment verification (Razorpay), call:

```js
await autoBookShiprocketForOrder(order);
```

✅ And ensure webhook updates tracking when AWB assigned later.

---

**End of README**
