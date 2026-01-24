// Xpressbees/xpressbees.mapper.js

import {
  XPRESSBEES_DEFAULTS,
  XPRESSBEES_PICKUP,
  XPRESSBEES_KEYS,
} from "./xpressbees.constants.js";

const cleanStr = (v) => String(v || "").trim();

const safeNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const safeInt = (v, fallback = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

function computeTotalWeightKg(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  let total = 0;

  for (const it of items) {
    const qty = Math.max(1, safeNum(it?.quantity, 1));
    const w =
      safeNum(it?.variant?.weight, 0) ||
      safeNum(it?.productSnapshot?.weight, 0) ||
      0;
    total += w * qty;
  }

  if (total <= 0) return XPRESSBEES_DEFAULTS.fallbackWeightKg;
  return Math.round(total * 100) / 100;
}

function computeDims() {
  return {
    lengthCm: XPRESSBEES_DEFAULTS.fallbackLengthCm,
    breadthCm: XPRESSBEES_DEFAULTS.fallbackBreadthCm,
    heightCm: XPRESSBEES_DEFAULTS.fallbackHeightCm,
  };
}

function getConsignee(order) {
  const s = order?.shippingAddressSnapshot || {};
  return {
    name: cleanStr(s.fullName),
    address: cleanStr(s.line1),
    address2: cleanStr(s.line2),
    city: cleanStr(s.city),
    state: cleanStr(s.state),
    pincode: cleanStr(s.pincode),
    country: cleanStr(s.country || "India"),
    phone: cleanStr(s.phone),
    email: cleanStr(s.email),
  };
}

function getPickup() {
  return {
    name: cleanStr(XPRESSBEES_PICKUP.name),
    address: cleanStr(XPRESSBEES_PICKUP.address),
    address2: cleanStr(XPRESSBEES_PICKUP.address2),
    city: cleanStr(XPRESSBEES_PICKUP.city),
    state: cleanStr(XPRESSBEES_PICKUP.state),
    pincode: cleanStr(XPRESSBEES_PICKUP.pincode),
    country: cleanStr(XPRESSBEES_PICKUP.country || "India"),
    phone: cleanStr(XPRESSBEES_PICKUP.phone),
    email: cleanStr(XPRESSBEES_PICKUP.email),
  };
}

function getOrderItems(order) {
  return (order?.items || []).map((it) => ({
    name: cleanStr(it?.productSnapshot?.title),
    sku: cleanStr(it?.variant?.sku) || cleanStr(it?.productSnapshot?.sku),
    quantity: Math.max(1, safeNum(it?.quantity, 1)),
    price: safeNum(it?.price, 0),
    hsnCode: cleanStr(it?.productSnapshot?.hsnCode) || "",
  }));
}

function buildPickupVendorCode(order) {
  const orderNo = cleanStr(order?.orderNumber).replace(/\s+/g, "");
  const pin = cleanStr(order?.shippingAddressSnapshot?.pincode);
  return `${orderNo || "MIRAY"}-${pin || "000000"}`.slice(0, 40);
}

function pickServiceType(order) {
  const st = cleanStr(order?.shipment?.serviceType);
  const allowed = new Set(["SD", "SDD", "NDD", "AIR", "SFC", "IntraSDD"]);
  return allowed.has(st) ? st : "SD";
}

function validateBasic(order) {
  const orderNumber = cleanStr(order?.orderNumber);
  const consignee = getConsignee(order);
  const pickup = getPickup();

  if (!orderNumber) throw new Error("orderNumber missing");
  if (!consignee?.name) throw new Error("shippingAddressSnapshot.fullName missing");
  if (!consignee?.phone) throw new Error("shippingAddressSnapshot.phone missing");
  if (!consignee?.pincode) throw new Error("shippingAddressSnapshot.pincode missing");

  if (!pickup?.address || !pickup?.pincode || !pickup?.phone) {
    throw new Error("Pickup address incomplete in XPRESSBEES_PICKUP constants");
  }
}

// ---------------------------------------------------------------------------
// 1) AWB Number Series Generation payload
// ---------------------------------------------------------------------------
export function mapOrderToAwbSeriesPayload(order) {
  if (!order) throw new Error("Order is required");
  validateBasic(order);

  const xbKey = cleanStr(XPRESSBEES_KEYS.xbAccessKey || XPRESSBEES_KEYS.xbKey);
  if (!xbKey) throw new Error("XB Key missing in XPRESSBEES_KEYS");

  const businessUnit = cleanStr(
    order?.shipment?.businessUnit ||
      XPRESSBEES_KEYS.businessUnit ||
      process.env.XPRESSBEES_BUSINESS_UNIT
  );
  if (!businessUnit) throw new Error("BusinessUnit missing (set XPRESSBEES_BUSINESS_UNIT)");

  // ServiceType here means shipment direction
  const st = cleanStr(order?.shipment?.serviceType) || "FORWARD";
  const serviceType = st === "REVERSE" ? "REVERSE" : "FORWARD";

  // DeliveryType here means payment type (as per XB error)
  const isCOD = String(order?.paymentMethod || "").toLowerCase() === "cod";
  const deliveryType = isCOD ? "COD" : "PREPAID";

  return {
    xbAccessKey: xbKey,
    xbKey: xbKey,

    BusinessUnit: businessUnit, // ECOM
    PickupVendorCode: buildPickupVendorCode(order),

    ServiceType: serviceType,   // FORWARD/REVERSE
    DeliveryType: deliveryType, // COD/PREPAID ✅

    Count: 1,
    ReferenceNo: cleanStr(order?.orderNumber),
  };
}





// ---------------------------------------------------------------------------
// 2) Forward Manifest payload
// ---------------------------------------------------------------------------
export function mapOrderToForwardManifestPayload(order, { awb } = {}) {
  if (!order) throw new Error("Order is required");
  validateBasic(order);

  const finalAwb = cleanStr(awb);
  if (!finalAwb) throw new Error("awb required for forward manifest payload");

  const consignee = getConsignee(order);
  const pickup = getPickup();
  const isCOD = order?.paymentMethod === "cod";

  const orderAmount = safeNum(order?.finalPayable, 0);
  const collectableAmount = isCOD ? orderAmount : 0;

  const dims = computeDims();
  const items = getOrderItems(order);

  return {
    awb: finalAwb,
    orderNumber: cleanStr(order?.orderNumber),
    pickupVendorCode: buildPickupVendorCode(order),
    serviceType: pickServiceType(order),

    paymentType: isCOD ? "COD" : "PREPAID",
    orderAmount,
    collectableAmount,

    weightKg: computeTotalWeightKg(order),
    lengthCm: dims.lengthCm,
    breadthCm: dims.breadthCm,
    heightCm: dims.heightCm,

    pickup,
    consignee,

    items: items.map((x) => ({
      name: x.name,
      sku: x.sku,
      quantity: safeInt(x.quantity, 1),
      price: safeNum(x.price, 0),
      hsnCode: cleanStr(x.hsnCode),
    })),
  };
}

// ---------------------------------------------------------------------------
// 3) Tracking Summary payload
// ---------------------------------------------------------------------------
export function mapAwbTrackingSummaryPayload({ awb }) {
  const finalAwb = cleanStr(awb);
  if (!finalAwb) throw new Error("awb required");
  return { awb: finalAwb };
}

// ---------------------------------------------------------------------------
// 4) Tracking Bulk payload
// ---------------------------------------------------------------------------
export function mapAwbTrackingBulkPayload({ awbs }) {
  if (!Array.isArray(awbs) || awbs.length === 0) throw new Error("awbs[] required");
  return { awbs: awbs.map(cleanStr).filter(Boolean) };
}

// ---------------------------------------------------------------------------
// 5) RTO cancel payload
// ---------------------------------------------------------------------------
export function mapRtoCancelPayload({ awb, reason = "cancelled_by_admin" }) {
  const finalAwb = cleanStr(awb);
  if (!finalAwb) throw new Error("awb required");
  return { awb: finalAwb, reason: cleanStr(reason) };
}
