// cronjob/shiprocket/shiprocketStatusMap.js

// Shiprocket status codes table -> your local statuses
const CODE_TO_LOCAL = {
  // shipped / movement
  6: "shipped",   // Shipped
  18: "shipped",  // In Transit
  38: "shipped",  // Reached Destination Hub
  49: "shipped",  // Custom Cleared
  50: "shipped",  // In Flight
  51: "shipped",  // Handover to Courier
  52: "shipped",  // ✅ Shipment Booked  -> shipped (as you want)
  54: "shipped",  // In Transit Overseas

  // out for delivery
  17: "out_for_delivery", // Out For Delivery

  // delivered
  7: "delivered",  // Delivered
  23: "delivered", // Partial Delivered (treat as delivered)

  // picked / pickup stage
  27: "picked", // Pickup Booked (you can keep picked; booked is pickup booking, not shipment booking)
  19: "picked", // Out For Pickup
  42: "picked", // Picked Up
  15: "picked", // Pickup Rescheduled
  20: "picked", // Pickup Exception (still pickup stage)

  // packed / warehouse-ish (optional)
  63: "packed", // Packed
  62: "packed", // Ready To Pack
  68: "packed", // Processed at Warehouse
  59: "packed", // Box Packing
  60: "packed", // FC Allocated
  61: "packed", // Picklist Generated
  67: "packed", // FC Manifest Generated

  // cancelled
  8: "cancelled",  // Canceled
  45: "cancelled", // Cancelled before dispatched
  16: "cancelled", // Cancellation Requested

  // rto
  9: "rto",   // RTO Initiated
  10: "rto",  // RTO Delivered
  14: "rto",  // RTO Acknowledged
  40: "rto",  // RTO_NDR
  41: "rto",  // RTO_OFD
  46: "rto",  // RTO in intransit
  78: "rto",  // Reached back at seller city
};

// If Shiprocket gives text instead of code, keep your keyword mapping too
export function mapShiprocketToLocal(srStatusRaw = "") {
  const raw = String(srStatusRaw).trim();

  // 1) if numeric code
  const code = Number(raw);
  if (!Number.isNaN(code) && CODE_TO_LOCAL[code]) return CODE_TO_LOCAL[code];

  // 2) if text
  const s = raw.toLowerCase();

  // ✅ delivered first
  if (s.includes("delivered") || s.includes("partial_delivered")) return "delivered";

  // ✅ out for delivery
  if (s.includes("out for delivery") || s.includes("ofd")) return "out_for_delivery";

  // ✅ RTO signals
  if (s.includes("rto")) return "rto";

  // ✅ cancelled
  if (s.includes("cancel")) return "cancelled";

  // ✅ booked -> shipped (as you asked)
  // Handles: "Shipment Booked", "Booked", "Handover to Courier", "Manifest Generated"
  if (
    s.includes("shipment booked") ||
    (s.includes("booked") && !s.includes("pickup")) || // booked but not pickup booked
    s.includes("handover to courier") ||
    s.includes("manifest generated") ||
    s.includes("reached at destination hub") ||
    s.includes("in flight") ||
    s.includes("custom cleared") ||
    s.includes("in transit") ||
    s.includes("shipped")
  ) {
    return "shipped";
  }

  // ✅ pickup/picked
  if (s.includes("picked up") || s.includes("pickup") || s.includes("out for pickup")) return "picked";

  // ✅ packed
  if (s.includes("packed") || s.includes("ready to pack") || s.includes("warehouse")) return "packed";

  return "processing";
}

export function extractShiprocketStatus(payload) {
  const td =
    payload?.tracking_data ||
    payload?.trackingData ||
    payload?.data?.tracking_data ||
    {};

  // Prefer numeric shipment_status if present
  if (td?.shipment_status != null && td?.shipment_status !== "") {
    return String(td.shipment_status);
  }

  // fallback to text
  return (
    td?.shipment_status_description ||
    td?.current_status ||
    payload?.current_status ||
    ""
  );
}

// Status priority to avoid downgrades
const PRIORITY = {
  processing: 1,
  packed: 2,
  picked: 3,
  shipped: 4,
  out_for_delivery: 5,
  delivered: 6,
  rto: 6,
  cancelled: 6,
};

export function shouldUpdateStatus(current, next) {
  const c = String(current || "processing");
  const n = String(next || "processing");

  // Always allow final statuses to override (delivered/rto/cancelled)
  if (["delivered", "rto", "cancelled"].includes(n)) return true;

  // Block downgrades
  return (PRIORITY[n] || 0) >= (PRIORITY[c] || 0);
}
