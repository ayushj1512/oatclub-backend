import { BLUEDART } from "./bluedart.constants.js";

const safe = (v) => (v == null ? "" : String(v).trim());

export const getBlueDartPaymentMode = (order = {}) => {
  const paymentMethod = safe(order?.paymentMethod).toLowerCase();

  if (paymentMethod === "cod") return "COD";
  return "Prepaid";
};

export const getBlueDartServiceType = (order = {}) => {
  const mode = getBlueDartPaymentMode(order);
  return mode === "COD"
    ? BLUEDART.SERVICE_TYPES.COD
    : BLUEDART.SERVICE_TYPES.PREPAID;
};

export const getOrderTotalWeight = (order = {}) => {
  const items = Array.isArray(order?.items) ? order.items : [];

  const sum = items.reduce((acc, item) => {
    const qty = Math.max(1, Number(item?.quantity || 1));
    const variantWeight = Number(item?.variant?.weight || 0);
    const productWeight = Number(item?.productSnapshot?.weight || 0);
    const weight = variantWeight > 0 ? variantWeight : productWeight;
    return acc + weight * qty;
  }, 0);

  return sum > 0 ? sum : BLUEDART.DEFAULTS.WEIGHT;
};

export const normalizePincode = (v) => safe(v).replace(/\D/g, "");
export const normalizePhone = (v) => safe(v).replace(/\D/g, "");

export const isValidIndianPincode = (v) => /^\d{6}$/.test(normalizePincode(v));
export const isValidPhone = (v) => /^\d{10,15}$/.test(normalizePhone(v));

export const assertAddressValid = (address = {}, label = "Address") => {
  if (!safe(address?.fullName)) throw new Error(`${label}: fullName is required`);
  if (!safe(address?.line1)) throw new Error(`${label}: line1 is required`);
  if (!safe(address?.city)) throw new Error(`${label}: city is required`);
  if (!safe(address?.state)) throw new Error(`${label}: state is required`);
  if (!isValidIndianPincode(address?.pincode)) {
    throw new Error(`${label}: valid pincode is required`);
  }
  if (!isValidPhone(address?.phone)) {
    throw new Error(`${label}: valid phone is required`);
  }
};

export const normalizeTrackingStatus = (rawStatus = "") => {
  const s = safe(rawStatus).toLowerCase();

  if (!s) return "created";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("out for delivery")) return "out_for_delivery";
  if (s.includes("transit")) return "in_transit";
  if (s.includes("pickup")) return "pickup_pending";
  if (s.includes("picked")) return "picked";
  if (s.includes("rto")) return "rto";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("exception") || s.includes("undelivered") || s.includes("failed")) {
    return "exception";
  }

  return "created";
};

export const parseDateSafe = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const nonEmpty = (v) => safe(v).length > 0;