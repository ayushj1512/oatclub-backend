import { BLUEDART } from "./bluedart.constants.js";
import {
  assertAddressValid,
  getBlueDartPaymentMode,
  getBlueDartServiceType,
} from "./bluedart.utils.js";

const safe = (v) => (v == null ? "" : String(v).trim());

const positive = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const countryToCode = (country) => {
  const c = safe(country).toLowerCase();
  if (!c) return "IN";
  if (c === "india" || c === "in") return "IN";
  return safe(country).toUpperCase();
};

const splitName = (fullName, fallbackFirst = "Customer") => {
  const parts = safe(fullName).split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || fallbackFirst,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
};

const FIXED_WEIGHT = 0.5;
const FIXED_LENGTH = 10;
const FIXED_BREADTH = 10;
const FIXED_HEIGHT = 10;
const FIXED_HSN_CODE = "62105000";

const getOrderDeclaredValue = (order = {}) => {
  return positive(
    order?.finalPayable ??
      order?.totalAmount ??
      order?.grandTotal ??
      order?.netAmount ??
      0,
    0
  );
};

const getOrderCurrency = (order = {}) => {
  return safe(order?.currency || BLUEDART?.DEFAULTS?.CURRENCY || "INR") || "INR";
};

const getItemDescription = (item = {}) => {
  return (
    safe(item?.productSnapshot?.title) ||
    safe(item?.productSnapshot?.name) ||
    safe(item?.name) ||
    safe(item?.title) ||
    safe(item?.productName) ||
    safe(item?.variant?.sku) ||
    safe(item?.productSnapshot?.productCode) ||
    "Fashion Accessories"
  );
};

const getItemSku = (item = {}) => {
  return (
    safe(item?.variant?.sku) ||
    safe(item?.productSnapshot?.sku) ||
    safe(item?.sku) ||
    ""
  );
};

const getItemHsCode = () => FIXED_HSN_CODE;

const getItemQuantity = (item = {}) => {
  return positive(item?.quantity, 1);
};

const getDefaultSender = () => ({
  fullName: process.env.BLUEDART_SENDER_NAME || "MIRAY",
  phone: process.env.BLUEDART_SENDER_PHONE || "",
  email: process.env.BLUEDART_SENDER_EMAIL || "",
  line1: process.env.BLUEDART_SENDER_LINE1 || "",
  line2: process.env.BLUEDART_SENDER_LINE2 || "",
  city: process.env.BLUEDART_SENDER_CITY || "",
  state: process.env.BLUEDART_SENDER_STATE || "",
  country: process.env.BLUEDART_SENDER_COUNTRY || "India",
  pincode: process.env.BLUEDART_SENDER_PINCODE || "",
});

const getShipmentWeight = (shipment = {}, fallback = FIXED_WEIGHT) => {
  return positive(shipment?.weight, fallback);
};

const getShipmentLength = (shipment = {}, fallback = FIXED_LENGTH) => {
  return positive(shipment?.dimensions?.length ?? shipment?.length, fallback);
};

const getShipmentBreadth = (shipment = {}, fallback = FIXED_BREADTH) => {
  return positive(
    shipment?.dimensions?.breadth ??
      shipment?.dimensions?.width ??
      shipment?.breadth ??
      shipment?.width,
    fallback
  );
};

const getShipmentHeight = (shipment = {}, fallback = FIXED_HEIGHT) => {
  return positive(
    shipment?.dimensions?.height ?? shipment?.height,
    fallback
  );
};

export const mapOrderAddressToRecipient = (order = {}) => {
  const a = order?.shippingAddressSnapshot || order?.shippingAddress || {};
  return {
    fullName: safe(a.fullName || a.name),
    phone: safe(a.phone || a.mobile),
    email: safe(a.email),
    line1: safe(a.line1 || a.addressLine1 || a.address1),
    line2: safe(a.line2 || a.addressLine2 || a.address2),
    city: safe(a.city),
    state: safe(a.state),
    country: safe(a.country || "India"),
    pincode: safe(a.pincode || a.zipcode || a.zip),
  };
};

export const buildBlueDartShipmentDocFromOrder = (order = {}, overrides = {}) => {
  const sender = { ...getDefaultSender(), ...(overrides.sender || {}) };
  const recipient = {
    ...mapOrderAddressToRecipient(order),
    ...(overrides.recipient || {}),
  };

  assertAddressValid(sender, "Sender");
  assertAddressValid(recipient, "Recipient");

  const paymentMode = getBlueDartPaymentMode(order);
  const serviceType = overrides.serviceType || getBlueDartServiceType(order);
  const declaredValue = getOrderDeclaredValue(order);
  const currency = getOrderCurrency(order);

  const finalWeight = positive(overrides.weight, FIXED_WEIGHT);
  const finalLength = positive(overrides.length, FIXED_LENGTH);
  const finalBreadth = positive(overrides.breadth, FIXED_BREADTH);
  const finalHeight = positive(overrides.height, FIXED_HEIGHT);

  return {
    orderNumber: safe(order?.orderNumber),
    orderId: order?._id || null,
    shipmentType: "forward",
    carrierSlug: BLUEDART?.CARRIER_SLUG || "bluedart",
    vendorId: BLUEDART?.VENDOR_ID || "",
    serviceType,
    paymentMode,
    codAmount: paymentMode === "COD" ? declaredValue : 0,
    declaredValue,
    currency,
    weight: finalWeight,
    dimensions: {
      length: finalLength,
      breadth: finalBreadth,
      height: finalHeight,
    },
    pieces: positive(
      overrides.pieces,
      Array.isArray(order?.items)
        ? Math.max(
            1,
            order.items.reduce((sum, item) => sum + Number(item?.quantity || 0), 0)
          )
        : 1
    ),
    sender,
    recipient,
    status: "draft",
    referenceNumber: safe(order?.orderNumber),
    notes: safe(overrides.notes),
    bookingRequestedAt: new Date(),
  };
};

const getOrderItemsForPayload = (order = {}, shipment = {}) => {
  const orderItems = Array.isArray(order?.items) ? order.items : [];
  const currency = safe(shipment?.currency || getOrderCurrency(order)) || "INR";

  const shipmentWeight = getShipmentWeight(shipment, FIXED_WEIGHT);
  const shipmentLength = getShipmentLength(shipment, FIXED_LENGTH);
  const shipmentBreadth = getShipmentBreadth(shipment, FIXED_BREADTH);
  const shipmentHeight = getShipmentHeight(shipment, FIXED_HEIGHT);

  if (!orderItems.length) {
    return [
      {
        description: "Fashion Accessories",
        quantity: 1,
        weight: {
          unit_of_measurement: "kg",
          value: shipmentWeight,
        },
        dimensions: {
          unit_of_measurement: "cms",
          length: shipmentLength,
          width: shipmentBreadth,
          height: shipmentHeight,
          irregular_parcel_girth: "",
        },
        value: {
          currency,
          amount: positive(shipment?.declaredValue, 0),
        },
        sku: "",
        hs_code: FIXED_HSN_CODE,
      },
    ];
  }

  return orderItems.map((item) => ({
    description: getItemDescription(item),
    quantity: getItemQuantity(item),
    weight: {
      unit_of_measurement: "kg",
      value: shipmentWeight,
    },
    dimensions: {
      unit_of_measurement: "cms",
      length: shipmentLength,
      width: shipmentBreadth,
      height: shipmentHeight,
      irregular_parcel_girth: "",
    },
    value: {
      currency,
      amount: positive(
        item?.price ??
          item?.finalPrice ??
          item?.salePrice ??
          item?.subtotal,
        0
      ),
    },
    sku: getItemSku(item),
    hs_code: getItemHsCode(),
  }));
};

/*
  eShipz Order Push Payload
  Endpoint: POST /api/v1/orders
*/
export const buildCreateShipmentPayload = (shipment = {}, order = null) => {
  const sourceOrder = order || {};
  const declaredValue = positive(
    shipment?.declaredValue,
    getOrderDeclaredValue(sourceOrder)
  );
  const currency = safe(shipment?.currency || getOrderCurrency(sourceOrder)) || "INR";
  const isCod = safe(shipment?.paymentMode).toUpperCase() === "COD";

  const receiverNames = splitName(shipment?.recipient?.fullName, "Customer");
  const senderNames = splitName(shipment?.sender?.fullName, "MIRAY");

  const totalPieces = positive(
    shipment?.pieces,
    Array.isArray(sourceOrder?.items)
      ? Math.max(
          1,
          sourceOrder.items.reduce((sum, item) => sum + Number(item?.quantity || 0), 0)
        )
      : 1
  );

  const items = getOrderItemsForPayload(sourceOrder, shipment);

  const payloadOrder = {
    order_id: safe(shipment?.referenceNumber || shipment?.orderNumber),
    store_name: "other",
    store_id: "other",
    shopify_order_id: "",
    order_created_on: "",
    is_cod: isCod,
    shipment_value: declaredValue,
    order_currency: currency,
    cod_amount: isCod ? positive(shipment?.codAmount, declaredValue) : 0,
    order_status: "processing",
    shipment_type: "Parcel",

    sender_address: {
      first_name: senderNames.firstName,
      last_name: senderNames.lastName,
      company_name: "MIRAY",
      address: [safe(shipment?.sender?.line1), safe(shipment?.sender?.line2)]
        .filter(Boolean)
        .join(", "),
      city: safe(shipment?.sender?.city),
      state: safe(shipment?.sender?.state),
      country: countryToCode(shipment?.sender?.country),
      zipcode: safe(shipment?.sender?.pincode),
      landmark: "",
      gst_number: "",
      phone: safe(shipment?.sender?.phone),
      email: safe(shipment?.sender?.email),
      id: safe(process.env.BLUEDART_SENDER_WAREHOUSE_ID || ""),
    },

    receiver_address: {
      first_name: receiverNames.firstName,
      last_name: receiverNames.lastName,
      company_name: "",
      address: [safe(shipment?.recipient?.line1), safe(shipment?.recipient?.line2)]
        .filter(Boolean)
        .join(", "),
      city: safe(shipment?.recipient?.city),
      state: safe(shipment?.recipient?.state),
      country: countryToCode(shipment?.recipient?.country),
      zipcode: safe(shipment?.recipient?.pincode),
      landmark: "",
      gst_number: "",
      phone: safe(shipment?.recipient?.phone),
      email: safe(shipment?.recipient?.email),
      id: "",
    },

    items,

    is_mps: false,

    parcels: [
      {
        quantity: totalPieces,
        weight: {
          unit_of_measurement: "kg",
          value: getShipmentWeight(shipment, FIXED_WEIGHT),
        },
        dimensions: {
          unit_of_measurement: "cm",
          length: getShipmentLength(shipment, FIXED_LENGTH),
          width: getShipmentBreadth(shipment, FIXED_BREADTH),
          height: getShipmentHeight(shipment, FIXED_HEIGHT),
        },
      },
    ],

    invoice_number: "",
    trip_id: safe(shipment?.orderNumber),
    po_number: safe(shipment?.referenceNumber || shipment?.orderNumber),
  };

  return {
    data: [payloadOrder],
  };
};

export const getEddPayloadFromShipment = (shipment = {}) => {
  return {
    originPincode: safe(shipment?.sender?.pincode),
    destinationPincode: safe(shipment?.recipient?.pincode),
    slug: safe(shipment?.carrierSlug || BLUEDART?.CARRIER_SLUG || "bluedart"),
  };
};

export { getDefaultSender };