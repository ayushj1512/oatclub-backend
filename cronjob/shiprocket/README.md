# Shiprocket Status Sync Cron

Updates Order.fulfillmentStatus + Order.shipment.status by polling Shiprocket tracking API.

## Env required
- MONGO_URI
- SHIPROCKET_TOKEN

## Run manually
node cronjob/shiprocket/shiprocketSync.js
