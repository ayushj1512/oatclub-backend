# Shiprocket Status Sync Cron

This cron syncs **local order shipment status** with **Shiprocket tracking** by polling Shiprocket’s tracking API.

It updates these fields in your `Order` document:

- `Order.fulfillmentStatus`
- `Order.shipment.status`
- (optionally) tracking metadata like:
  - `shipment.shiprocket.courierName`
  - `shipment.shiprocket.trackingUrl`
  - `shipment.shiprocket.lastStatusRaw`
  - `shipment.shiprocket.lastStatusMapped`
  - `shipment.shiprocket.lastSyncAt`
  - `shipment.deliveredAt`, `trackingDetails.deliveredAt` (when delivered)
  - `shipment.shippedAt`, `trackingDetails.shippedAt` (when shipped-like)

---

## How it works (high level)

1. Fetch candidate orders from MongoDB:
   - `isConfirmed: true`
   - `shipment.provider: "shiprocket"`
   - `shipment.shiprocket.shipmentId` exists (non-empty)
   - `fulfillmentStatus` is **not** in final/RMA states (delivered/cancelled/rto/return/exchange)

2. For each order, call Shiprocket tracking API using **shipmentId**:
   - `GET /v1/external/courier/track/shipment/:shipmentId`

3. Extract Shiprocket status from payload, map to local status, then apply safety gates:
   - Only `out_for_delivery` and `delivered` are allowed to be written by this cron.
   - Never touch blocked lifecycle states (return/exchange/cancel/rto).
   - Never downgrade statuses.

4. If eligible, update DB (unless running in DRY_RUN).

---

## Status mapping

Shiprocket returns a numeric status code (e.g. `"7"`, `"17"`, `"18"`) or a text description.

The cron maps Shiprocket → local status via `cronjob/shiprocket/shiprocketStatusMap.js`:

Examples:
- `17` → `out_for_delivery`
- `7`  → `delivered`
- `18` → `shipped`
- `42` / `19` → `picked`

---

## Safety gates (important)

This cron is intentionally conservative:

- ✅ Allowed writes: **only**
  - `out_for_delivery`
  - `delivered`

- ⛔ Blocked (never update from cron):
  - return/exchange lifecycle states
  - cancelled/rto etc (as defined in `BLOCKED_FROM_CRON`)

- ✅ Progression only:
  - only “before OFD” statuses can move to OFD/Delivered
  - plus OFD → Delivered is allowed
  - downgrades are rejected

---

## Env required

- `MONGO_URI`
- `SHIPROCKET_TOKEN`

---

## Dry Run vs Real Run

The script supports a **DRY_RUN mode** to test safely.

Inside `cronjob/shiprocket/shiprocketSync.js`:

- `const DRY_RUN = true;`  
  - No DB writes
  - Prints `WOULD_UPDATE` for orders that would be updated

- `const DRY_RUN = false;`  
  - Real DB writes
  - Prints `UPDATED`

---

## Debugging

Useful toggles inside `cronjob/shiprocket/shiprocketSync.js`:

- `DEBUG_PRINT_EACH_ORDER`
  - prints a single summary line per order, including:
    - orderNumber
    - shipmentId
    - current local status
    - shiprocket raw status
    - mapped local status
    - decision + reason

- `DEBUG_PRINT_RAW_PAYLOAD`
  - prints raw Shiprocket payload for the first few orders (limited)

- `MAX_ORDERS`
  - limit processing for faster timing tests

---

## Run manually

```bash
node cronjob/shiprocket/shiprocketSync.js