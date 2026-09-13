````md
# OATCLUB NDR System

OATCLUB NDR system identifies failed deliveries, helps the team contact customers and submits courier-specific delivery actions.

## Current Status

| Feature | Delhivery | Shiprocket |
|---|---:|---:|
| Tracking sync | Complete | Planned |
| NDR detection | Complete | Planned |
| Admin dashboard | Complete | Planned |
| Customer page | Complete | Reusable |
| Call customer | Complete | Planned |
| WhatsApp link | Complete | Planned |
| Delivery reattempt | Complete | Planned |
| Request-status check | Complete | Planned |

---

# Delhivery NDR

## Workflow

1. Fetch every active Delhivery order from MongoDB.
2. Extract its AWB number.
3. Send AWBs to Delhivery in batches of 50.
4. Save the latest tracking response.
5. Detect eligible NDR shipments.
6. Display eligible shipments in the admin dashboard.
7. Call the customer or send the customer action link.
8. Submit reattempt after customer confirmation.

> The system checks every matching order.
> `50` is only the API batch size, not the total order limit.

## Supported Action

```text
RE-ATTEMPT
````

Address updates and forward-delivery rescheduling are not submitted through the current Delhivery NDR API flow.

## Eligible NDR Codes

```js
[
  "EOD-74",
  "EOD-15",
  "EOD-104",
  "EOD-43",
  "EOD-86",
  "EOD-11",
  "EOD-69",
  "EOD-6",
]
```

A shipment is eligible when:

* It contains a supported NDR code or failed-delivery status.
* The attempt count is 1 or 2.
* The order is not delivered, cancelled, returned or RTO-delivered.
* A valid Delhivery AWB is available.

## Batch Processing

```text
1–50 AWBs    → Batch 1
51–100 AWBs  → Batch 2
101–150 AWBs → Batch 3
```

Every batch is processed until all AWBs are checked.

---

# Backend Routes

Base path:

```text
/api/delhivery
```

## Sync NDR Orders

```http
GET /api/delhivery/ndr/orders/sync
```

Example response:

```json
{
  "success": true,
  "data": {
    "totalOrders": 120,
    "totalWaybills": 120,
    "totalBatches": 3,
    "totalNdrOrders": 6,
    "ndrOrders": [],
    "orders": [],
    "syncErrors": []
  }
}
```

## Get Customer Order

```http
GET /api/delhivery/ndr/customer/:orderNumber
```

Example:

```http
GET /api/delhivery/ndr/customer/000415
```

## Submit Admin Reattempt

```http
POST /api/delhivery/ndr/:waybill/action
Content-Type: application/json
```

```json
{
  "action": "RE-ATTEMPT"
}
```

## Submit Customer Reattempt

```http
POST /api/delhivery/ndr/customer/:orderNumber/action
Content-Type: application/json
```

```json
{
  "action": "RE-ATTEMPT"
}
```

## Check NDR Request Status

```http
GET /api/delhivery/ndr/status/:requestId
```

---

# Admin Dashboard

Location:

```text
oatclub-admin/app/ndr/delhivery/page.jsx
```

Store:

```text
oatclub-admin/store/delhiveryStore.js
```

Admin users can:

* Sync active Delhivery orders
* Search by order, AWB, customer or phone
* View customer and product information
* View NDR reason and attempt count
* Call the customer
* Open WhatsApp with a prepared message
* Submit a delivery reattempt

---

# Customer Page

Location:

```text
oatclub-storefront/src/app/orders/ndr/[order-number]/page.jsx
```

Store:

```text
oatclub-storefront/src/store/ndrStore.js
```

Production URL:

```text
https://oatclub.in/orders/ndr/:orderNumber
```

Local URL:

```text
http://localhost:4001/orders/ndr/:orderNumber
```

Example:

```text
http://localhost:4001/orders/ndr/000415
```

The customer can:

* View the order
* View current delivery details
* View the failed-delivery reason
* Request another delivery attempt

---

# Important Backend Files

```text
oatclub-backend/delhivery/
├── client.js
├── config.js
├── constants.js
├── controller.js
├── ndr.js
├── routes.js
├── tracking.js
├── webhook.js
└── README.md
```

---

# Future Shiprocket NDR

Shiprocket will use the same admin and customer experience with separate provider-specific API functions.

## Planned Backend Files

```text
oatclub-backend/shiprocket/
├── shiprocket.ndr.js
├── shiprocket.client.js
├── shipping.controller.js
├── shipping.routes.js
└── shiprocket.webhook.js
```

## Planned Routes

```http
GET  /api/shiprocket/ndr/orders/sync
GET  /api/shiprocket/ndr/customer/:orderNumber
POST /api/shiprocket/ndr/:awb/action
POST /api/shiprocket/ndr/customer/:orderNumber/action
GET  /api/shiprocket/ndr/:awb/status
```

## Common NDR Format

Both providers should return the same frontend-friendly structure:

```json
{
  "orderNumber": "000415",
  "provider": "delhivery",
  "customer": {
    "name": "Customer",
    "phone": "9876543210"
  },
  "products": [],
  "pricing": {
    "finalPayable": 1498,
    "currency": "INR"
  },
  "ndr": {
    "waybill": "60502510001201",
    "statusCode": "EOD-11",
    "reason": "Consignee unavailable",
    "attemptCount": 2,
    "eligible": true,
    "allowedActions": [
      "RE-ATTEMPT"
    ]
  }
}
```

## Final Unified Flow

```text
Delhivery + Shiprocket
          ↓
  Sync Tracking Data
          ↓
   Detect NDR Orders
          ↓
OATCLUB Admin Dashboard
          ↓
 Call or Send WhatsApp
          ↓
 Customer Action Page
          ↓
 Provider-Specific Action
```

---

# Testing Checklist

* [ ] All active Delhivery AWBs are collected
* [ ] More than 50 AWBs create multiple batches
* [ ] Every batch is processed
* [ ] NDR codes are detected
* [ ] Failed-delivery text is detected
* [ ] Attempt count is detected correctly
* [ ] Eligible NDR orders appear in admin
* [ ] Customer and product details appear
* [ ] Call button opens the dialler
* [ ] WhatsApp opens with the correct link
* [ ] Customer NDR page loads
* [ ] Reattempt request reaches Delhivery
* [ ] Delhivery returns a request ID
* [ ] Delivered and cancelled orders are excluded
* [ ] `syncErrors` remains empty

```
```
