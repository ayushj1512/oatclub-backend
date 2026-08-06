Courier Integration Refactor — README

Goal

Decouple warehouse packing from courier booking.

Packing an order should only mark the order as physically packed. Courier assignment and shipment booking should happen later from the Ready to Ship screen.

Final Flow

Order Created
    ↓
Confirmed
    ↓
Packed
    ↓
Ready to Ship
    ↓
Auto Serviceability + Rate Check
    ↓
Choose Courier
    ↓
Book Shipment
    ↓
AWB / Label / Tracking
    ↓
Pickup
    ↓
Shipped

Completed

Backend

Packed orders endpoint created.

Courier assignment endpoint created.

Shiprocket rate/serviceability endpoint created.

Delhivery serviceability endpoint created.

Delhivery rate endpoint created.

Delhivery booking endpoint connected.

Delhivery serviceability now checks:

pincode existence

COD availability

prepaid availability

pickup availability

embargo/restricted status

Delhivery rate is fetched only after serviceability passes.

Provider is assigned only after successful booking.

Failed booking no longer leaves a wrong provider assignment.

Duplicate booking code removed from frontend flow.

Admin

Route:

/dispatching/ready-to-ship

The page currently supports:

Packed orders table

Auto rate checking on page load

Shiprocket multiple courier options

Delhivery direct price

Shiprocket courier dropdown

Serviceability status

Disabled unavailable couriers

Per-order booking

Bulk selection

Bulk Shiprocket booking

Bulk Delhivery booking

Eligible order count

Retry rate check

Order value, customer, location, payment and packed time

Current Booking Rules

Shiprocket

Shiprocket returns serviceability and rates together.

Book only when:

shiprocketOptions.length > 0

A courier company must be selected before booking.

Delhivery

Delhivery flow:

Check pincode serviceability
    ↓
Check embargo/restriction
    ↓
Check COD or prepaid availability
    ↓
Fetch rate
    ↓
Enable booking

Book only when:

option.serviceable === true &&
option.pricingAvailable === true &&
Number(option.rate || 0) > 0

The actual shipment creation response remains the final source of truth.

Important Delhivery Finding

A pincode may return:

{
  "cod": "Y",
  "pre_paid": "Y"
}

but still contain:

{
  "remarks": "Embargo"
}

Such a pincode must be treated as non-serviceable.

Correct rule:

serviceable =
  pincodeExists &&
  !embargoed &&
  paymentModeAvailable;

Pending Work

Priority 1 — Booking Response Persistence

After successful booking, save these values in the order:

shipment.provider
shipment.status
shipment.awb
shipment.courierName
shipment.labelUrl
shipment.trackingUrl
shipment.bookedAt
shipment.bookedBy

Provider-specific response:

shipment.shiprocket
shipment.delhivery

Also save:

upload_wbn
raw response
selected courier id
selected rate

Priority 2 — Duplicate Booking Protection

Before booking:

If AWB exists → do not book again
If shipment is already booked → return existing shipment
If previous booking failed → allow retry

Recommended message:

Shipment is already booked for this order.

Priority 3 — Label

Add:

Generate label
Download label
Bulk label download
Print labels
Save label URL in order

Suggested route:

GET /api/shipping/:orderId/label

Priority 4 — Pickup

Add:

Create pickup request
Schedule earliest pickup
Save pickup date
Save pickup status
Group shipments by provider

Shiprocket and Delhivery pickups must remain separate.

Priority 5 — Tracking

Add:

Manual tracking sync
Webhook tracking updates
AWB-based tracking
Tracking URL

Suggested fulfillment mapping:

shipment_booked
→ shipped
→ out_for_delivery
→ delivered

Also support:

ndr
rto
cancelled
lost
failed

Priority 6 — Cancellation and Rebooking

Add:

Cancel shipment
Clear active AWB
Store cancellation reason
Allow courier change
Allow rebooking

Never delete old provider history.

Priority 7 — Logs

Create shipment logs for:

rate_checked
serviceability_checked
courier_selected
booking_started
booking_succeeded
booking_failed
label_generated
pickup_created
tracking_updated
shipment_cancelled

Recommended fields:

orderId
provider
action
request
response
error
createdAt
createdBy

Never save or print API tokens.

Recommended Future Backend Structure

shipping/
├── controller.js
├── routes.js
├── service.js
├── providerRegistry.js
├── shipmentLogs.js
└── providers/
    ├── shiprocket.provider.js
    ├── delhivery.provider.js
    └── future.provider.js

Common provider methods:

checkServiceability()
getRates()
bookShipment()
getLabel()
trackShipment()
cancelShipment()
createPickup()

Testing Checklist

A. Packing Flow

Test A1 — Pack Order

Confirm an order.

Pack the order.

Check the order in database.

Check Shiprocket dashboard.

Check Delhivery dashboard.

Expected:

fulfillmentStatus = packed
shipment.provider = unassigned
shipment.awb = empty
No shipment created automatically
Order appears in Ready to Ship

B. Ready to Ship Screen

Test B1 — Page Load

Open /dispatching/ready-to-ship.

Wait for automatic checks.

Expected:

Packed orders load
Shiprocket rates load
Delhivery serviceability checks
Delhivery rate loads only if serviceable
Unavailable couriers become disabled

Test B2 — Invalid Pincode

Use an order with an invalid or missing pincode.

Expected:

No booking enabled
Clear validation message
No rate API booking attempt

C. Shiprocket Testing

Test C1 — Serviceable Order

Expected:

Multiple courier options shown
Courier names shown
Rates shown
ETA shown when available
Cheapest option selected first
Booking button enabled

Test C2 — Non-Serviceable Order

Expected:

No courier options
No courier available message
Booking button disabled
Bulk booking skips order

Test C3 — Single Booking

Select one Shiprocket courier.

Click Shiprocket.

Expected:

Shipment booked once
AWB generated
Provider saved as shiprocket
Selected courier saved
Order removed from Ready to Ship after refresh

D. Delhivery Testing

Test D1 — Serviceable COD Pincode

Expected:

serviceable = true
codAvailable = true
rate returned
pricingAvailable = true
Delhivery button enabled

Test D2 — Serviceable Prepaid Pincode

Expected:

prepaidAvailable = true
rate returned
Delhivery button enabled

Test D3 — Embargo Pincode

Example already found:

795008

Expected:

serviceable = false
embargoed = true
No rate request
Not serviceable shown
Delhivery button disabled
Bulk booking skips order

Test D4 — Booking Failure

Expected:

Provider remains unassigned
No AWB saved
Error shown clearly
Retry remains available

Test D5 — Booking Success

Expected:

AWB saved
provider = delhivery
courierName = Delhivery Direct
shipment status updated
raw provider response saved

E. Bulk Booking Testing

Test E1 — Mixed Selection

Select:

2 Shiprocket-serviceable orders
1 Delhivery-serviceable order
1 unavailable order

Expected for Shiprocket bulk booking:

Only Shiprocket eligible orders booked
Unavailable orders skipped
Correct booked/skipped count shown

Expected for Delhivery bulk booking:

Only Delhivery eligible orders booked
Unavailable orders skipped
No wrong provider assignment

Test E2 — Nothing Eligible

Expected:

Bulk button disabled
or
Clear no eligible orders message

Test E3 — Double Click

Expected:

Button becomes disabled while booking
No duplicate shipment
No duplicate AWB

F. Failure Testing

Test these scenarios:

Shiprocket timeout
Delhivery timeout
Invalid API token
Provider API 500
Rate API returns empty response
Booking API returns success false
Network disconnected
Order already booked
AWB already exists

Expected:

No wrong provider assignment
No duplicate booking
Clean error message
Order remains retryable

G. Database Verification

After successful booking verify:

shipment.provider
shipment.awb
shipment.courierName
shipment.status
shipment.trackingUrl
shipment.labelUrl
shipment.bookedAt
provider raw response

After failed booking verify:

shipment.awb remains empty
shipment.provider remains unassigned
fulfillmentStatus remains packed

Final Acceptance Criteria

The courier refactor is complete when:

Packing never creates a shipment automatically.

Every packed order appears in Ready to Ship.

Rates and serviceability load automatically.

Unavailable couriers cannot be booked.

Bulk booking skips unavailable orders.

Provider is saved only after successful booking.

Duplicate booking is prevented.

AWB and courier details are saved correctly.

Labels, pickup and tracking work independently per provider.

Next Session Order

1. Save booking response properly
2. Prevent duplicate booking
3. Label generation
4. Pickup scheduling
5. Tracking + webhooks
6. Cancellation + rebooking
7. Shipment logs
8. NDR and RTO
