const CODE_TO_LOCAL = {
  // shipped / movement
  6: "shipped",
  18: "shipped",
  38: "shipped",
  49: "shipped",
  50: "shipped",
  51: "shipped",
  52: "shipped",
  54: "shipped",

  // out for delivery
  17: "out_for_delivery",

  // delivered
  7: "delivered",
  23: "delivered",

  // picked / pickup stage
  27: "picked",
  19: "picked",
  42: "picked",
  15: "picked",
  20: "picked",

  // packed
  63: "packed",
  62: "packed",
  68: "packed",
  59: "packed",
  60: "packed",
  61: "packed",
  67: "packed",

  // cancelled
  8: "cancelled",
  45: "cancelled",
  16: "cancelled",

  // rto
  9: "rto",
  10: "rto",
  14: "rto",
  40: "rto",
  41: "rto",
  46: "rto",
  78: "rto",
};

export function mapShiprocketToLocal(srStatusRaw = "") {
  const raw = String(srStatusRaw).trim();

  // 1) numeric code
  const code = Number(raw);
  if (!Number.isNaN(code) && CODE_TO_LOCAL[code]) return CODE_TO_LOCAL[code];

  // 2) text fallback
  const s = raw.toLowerCase();

  if (s.includes("delivered") || s.includes("partial_delivered")) return "delivered";
  if (s.includes("out for delivery") || s.includes("ofd")) return "out_for_delivery";
  if (s.includes("rto")) return "rto";
  if (s.includes("cancel")) return "cancelled";

  if (
    s.includes("shipment booked") ||
    (s.includes("booked") && !s.includes("pickup")) ||
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

  if (s.includes("picked up") || s.includes("pickup") || s.includes("out for pickup"))
    return "picked";

  if (s.includes("packed") || s.includes("ready to pack") || s.includes("warehouse"))
    return "packed";

  return "processing";
}

export function extractShiprocketStatus(payload) {
  const td =
    payload?.tracking_data ||
    payload?.trackingData ||
    payload?.data?.tracking_data ||
    {};

  if (td?.shipment_status != null && td?.shipment_status !== "") {
    return String(td.shipment_status);
  }

  return (
    td?.shipment_status_description ||
    td?.current_status ||
    payload?.current_status ||
    ""
  );
}

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

  if (["delivered", "rto", "cancelled"].includes(n)) return true;
  return (PRIORITY[n] || 0) >= (PRIORITY[c] || 0);
}
