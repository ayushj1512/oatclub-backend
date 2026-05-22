import { BLUEDART } from "./bluedart.constants.js";
import {
  assertAddressValid,
  getBlueDartPaymentMode,
  getBlueDartServiceType,
  normalizeCarrierSlug,
  normalizeCourierName,
} from "./bluedart.utils.js";

const safe = (v) => (v == null ? "" : String(v).trim());

const positive = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const toDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const pad2 = (v) => String(v).padStart(2, "0");

const formatEshipzDateTime = (value) => {
  const d = toDateOrNull(value);
  if (!d) return "";

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
    d.getDate()
  )} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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

const FIXED_WEIGHT = Number(BLUEDART?.DEFAULTS?.WEIGHT || 0.5);
const FIXED_LENGTH = Number(BLUEDART?.DEFAULTS?.LENGTH || 10);
const FIXED_BREADTH = Number(BLUEDART?.DEFAULTS?.BREADTH || 10);
const FIXED_HEIGHT = Number(BLUEDART?.DEFAULTS?.HEIGHT || 10);
const FIXED_HSN_CODE = String(BLUEDART?.DEFAULTS?.HSN_CODE || "62105000");

const DEFAULT_CARRIER_NAME = normalizeCourierName(
  BLUEDART?.CARRIER_NAME || "BlueDart"
);

const DEFAULT_CARRIER_SLUG = normalizeCarrierSlug(
  BLUEDART?.CARRIER_SLUG || DEFAULT_CARRIER_NAME
);

const getOrderDeclaredValue = (order = {}) =>
  positive(
    order?.finalPayable ??
      order?.totalAmount ??
      order?.grandTotal ??
      order?.netAmount ??
      0,
    0
  );

const getOrderCurrency = (order = {}) =>
  safe(order?.currency || BLUEDART?.DEFAULTS?.CURRENCY || "INR") || "INR";

const getItemDescription = (item = {}) =>
  safe(item?.productSnapshot?.title) ||
  safe(item?.productSnapshot?.name) ||
  safe(item?.name) ||
  safe(item?.title) ||
  safe(item?.productName) ||
  safe(item?.variant?.sku) ||
  safe(item?.productSnapshot?.productCode) ||
  "Fashion Accessories";

const getItemSku = (item = {}) =>
  safe(item?.variant?.sku) || safe(item?.productSnapshot?.sku) || safe(item?.sku);

const getItemHsCode = (item = {}) =>
  safe(item?.productSnapshot?.hsnCode) || safe(item?.hsnCode) || FIXED_HSN_CODE;

const getItemQuantity = (item = {}) => positive(item?.quantity, 1);

const getItemPrice = (item = {}) =>
  positive(item?.price ?? item?.finalPrice ?? item?.salePrice ?? item?.subtotal, 0);

const getDefaultSender = () => ({
  fullName:
    process.env.ESHIPZ_SENDER_NAME ||
    process.env.BLUEDART_SENDER_NAME ||
    "MIRAY",
  phone:
    process.env.ESHIPZ_SENDER_PHONE ||
    process.env.BLUEDART_SENDER_PHONE ||
    "",
  email:
    process.env.ESHIPZ_SENDER_EMAIL ||
    process.env.BLUEDART_SENDER_EMAIL ||
    "",
  line1:
    process.env.ESHIPZ_SENDER_LINE1 ||
    process.env.BLUEDART_SENDER_LINE1 ||
    "",
  line2:
    process.env.ESHIPZ_SENDER_LINE2 ||
    process.env.BLUEDART_SENDER_LINE2 ||
    "",
  city:
    process.env.ESHIPZ_SENDER_CITY ||
    process.env.BLUEDART_SENDER_CITY ||
    "",
  state:
    process.env.ESHIPZ_SENDER_STATE ||
    process.env.BLUEDART_SENDER_STATE ||
    "",
  country:
    process.env.ESHIPZ_SENDER_COUNTRY ||
    process.env.BLUEDART_SENDER_COUNTRY ||
    "India",
  pincode:
    process.env.ESHIPZ_SENDER_PINCODE ||
    process.env.BLUEDART_SENDER_PINCODE ||
    "",
});

const getWarehouseId = () =>
  safe(
    process.env.ESHIPZ_SENDER_WAREHOUSE_ID ||
      process.env.BLUEDART_SENDER_WAREHOUSE_ID ||
      ""
  );

const getShipmentWeight = (shipment = {}, fallback = FIXED_WEIGHT) =>
  positive(shipment?.weight, fallback);

const getShipmentLength = (shipment = {}, fallback = FIXED_LENGTH) =>
  positive(shipment?.dimensions?.length ?? shipment?.length, fallback);

const getShipmentBreadth = (shipment = {}, fallback = FIXED_BREADTH) =>
  positive(
    shipment?.dimensions?.breadth ??
      shipment?.dimensions?.width ??
      shipment?.breadth ??
      shipment?.width,
    fallback
  );

const getShipmentHeight = (shipment = {}, fallback = FIXED_HEIGHT) =>
  positive(shipment?.dimensions?.height ?? shipment?.height, fallback);

const normalizeShipmentStatus = (status = "") => {
  const raw = safe(status).toLowerCase().replace(/\s+/g, "_");
  if (!raw) return "";
  return BLUEDART?.STATUS_MAP?.[raw] || raw;
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
  const carrierName = normalizeCourierName(
    overrides.carrierName || BLUEDART?.CARRIER_NAME || DEFAULT_CARRIER_NAME
  );

  const carrierSlug = normalizeCarrierSlug(
    overrides.carrierSlug || BLUEDART?.CARRIER_SLUG || carrierName
  );

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

  const pieces = positive(
    overrides.pieces,
    Array.isArray(order?.items)
      ? Math.max(
          1,
          order.items.reduce((sum, item) => sum + Number(item?.quantity || 0), 0)
        )
      : 1
  );

  return {
    orderNumber: safe(order?.orderNumber),
    orderId: order?._id || null,
    shipmentType: "forward",

    partner: "eshipz",
    provider: "eshipz",

    carrierName,
    carrierSlug,

    vendorId: BLUEDART?.VENDOR_ID || "",
    serviceType,

    paymentMode,
    codAmount: paymentMode === "COD" ? declaredValue : 0,

    declaredValue,
    currency,

    weight: positive(overrides.weight, FIXED_WEIGHT),
    dimensions: {
      length: positive(overrides.length, FIXED_LENGTH),
      breadth: positive(overrides.breadth, FIXED_BREADTH),
      height: positive(overrides.height, FIXED_HEIGHT),
    },

    pieces,
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

  const shipmentWeight = getShipmentWeight(shipment);
  const shipmentLength = getShipmentLength(shipment);
  const shipmentBreadth = getShipmentBreadth(shipment);
  const shipmentHeight = getShipmentHeight(shipment);

  if (!orderItems.length) {
    return [
      {
        description: "Fashion Accessories",
        quantity: 1,
        weight: { unit_of_measurement: "kg", value: shipmentWeight },
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
    weight: { unit_of_measurement: "kg", value: shipmentWeight },
    dimensions: {
      unit_of_measurement: "cms",
      length: shipmentLength,
      width: shipmentBreadth,
      height: shipmentHeight,
      irregular_parcel_girth: "",
    },
    value: {
      currency,
      amount: getItemPrice(item),
    },
    sku: getItemSku(item),
    hs_code: getItemHsCode(item),
  }));
};

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

  const payloadOrder = {
order_id: `${safe(shipment?.referenceNumber || shipment?.orderNumber)}-${Date.now()}`,  //   service_type:
  // safe(shipment?.serviceType) ||
  // getBlueDartServiceType(sourceOrder) ||
  // (isCod ? "eTailCODAir" : "eTailPrePaidAir"),

    store_name: BLUEDART?.STORE_NAME || "other",
    store_id: BLUEDART?.STORE_ID || "other",
    shopify_order_id: "",

    order_created_on: formatEshipzDateTime(
      sourceOrder?.orderDate || sourceOrder?.createdAt || new Date()
    ),

    is_cod: isCod,
    shipment_value: declaredValue,
    order_currency: currency,
    cod_amount: isCod ? positive(shipment?.codAmount, declaredValue) : 0,
    order_status: "processing",
    shipment_type: "Parcel",

    sender_address: {
      first_name: senderNames.firstName,
      last_name: senderNames.lastName,
      company_name: BLUEDART?.SENDER_COMPANY_NAME || "MIRAY",
      address: [safe(shipment?.sender?.line1), safe(shipment?.sender?.line2)]
        .filter(Boolean)
        .join(", "),
      city: safe(shipment?.sender?.city),
      state: safe(shipment?.sender?.state),
      country: countryToCode(shipment?.sender?.country),
      zipcode: safe(shipment?.sender?.pincode),
      landmark: "",
      gst_number: safe(
        process.env.ESHIPZ_GST_NUMBER || process.env.BLUEDART_GST_NUMBER || ""
      ),
      phone: safe(shipment?.sender?.phone),
      email: safe(shipment?.sender?.email),
      id: getWarehouseId(),
    },

    receiver_address: {
      first_name: receiverNames.firstName,
      last_name: receiverNames.lastName,
      company_name: "",
      address: [
        safe(shipment?.recipient?.line1),
        safe(shipment?.recipient?.line2),
      ]
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

    items: getOrderItemsForPayload(sourceOrder, shipment),

    is_mps: false,

    parcels: [
      {
        quantity: totalPieces,
        weight: {
          unit_of_measurement: "kg",
          value: getShipmentWeight(shipment),
        },
        dimensions: {
          unit_of_measurement: "cm",
          length: getShipmentLength(shipment),
          width: getShipmentBreadth(shipment),
          height: getShipmentHeight(shipment),
        },
      },
    ],

    invoice_number: safe(sourceOrder?.invoiceNumber || ""),
   trip_id: `${safe(shipment?.orderNumber)}-${Date.now()}`,
po_number: `${safe(shipment?.referenceNumber || shipment?.orderNumber)}-${Date.now()}`,
  };

  console.log("\n========== ESHIPZ MAPPER PAYLOAD CHECK ==========");
console.log("ORDER_ID:", payloadOrder.order_id);
console.log("SERVICE_TYPE:", payloadOrder.service_type);
console.log("IS_COD:", payloadOrder.is_cod);
console.log("COD_AMOUNT:", payloadOrder.cod_amount);
console.log("SHIPMENT_VALUE:", payloadOrder.shipment_value);
console.log("===============================================\n");

  return { data: [payloadOrder] };
};

export const getEddPayloadFromShipment = (shipment = {}) => ({
  originPincode: safe(shipment?.sender?.pincode),
  destinationPincode: safe(shipment?.recipient?.pincode),
  slug: safe(
    shipment?.carrierSlug || BLUEDART?.CARRIER_SLUG || DEFAULT_CARRIER_SLUG
  ),
});

export const mapTrackingEventToShipmentEvent = (event = {}) => ({
  eventCode: safe(event?.eventCode || event?.code || event?.status),
  eventName: safe(event?.eventName || event?.status || event?.activity),
  eventDescription: safe(
    event?.eventDescription || event?.description || event?.remarks || event?.message
  ),
  eventLocation: safe(event?.eventLocation || event?.location || event?.scan_location),
  eventTime: toDateOrNull(
    event?.eventTime ||
      event?.date ||
      event?.time ||
      event?.datetime ||
      event?.scan_time
  ),
  raw: event?.raw || event,
});

export const mapTrackingToShipmentUpdate = (tracking = {}) => {
  const t = tracking?.tracking || tracking || {};

  const rawStatus = safe(t?.status || t?.rawStatus);
  const normalizedStatus = normalizeShipmentStatus(rawStatus);

  const events = Array.isArray(t?.events)
    ? t.events.map(mapTrackingEventToShipmentEvent)
    : [];

  const latestEvent = events?.[0] || {};

  const update = {
    rawTrackingResponse: t?.raw || tracking,
    lastTrackAt: new Date(),
    lastSyncedAt: new Date(),
    syncPending: false,
    syncError: "",

    latestTrackingRemark:
      safe(t?.description) ||
      safe(latestEvent?.eventDescription) ||
      safe(rawStatus),

    latestTrackingLocation: safe(t?.location) || safe(latestEvent?.eventLocation),

    trackingEvents: events,
  };

  if (rawStatus) update.rawStatus = rawStatus;
  if (normalizedStatus) update.status = normalizedStatus;

  if (safe(t?.awbNumber)) {
    update.awbNumber = safe(t.awbNumber);
    update.awb = safe(t.awbNumber);
  }

  if (safe(t?.referenceNumber)) update.referenceNumber = safe(t.referenceNumber);

  if (safe(t?.shipmentId)) {
    update.shipmentId = safe(t.shipmentId);
    update.shipmentIdExternal = safe(t.shipmentId);
  }

  if (safe(t?.carrier)) update.carrierName = normalizeCourierName(t.carrier);
  if (safe(t?.carrierSlug)) update.carrierSlug = normalizeCarrierSlug(t.carrierSlug);

  const expectedDelivery = toDateOrNull(t?.edd);
  if (expectedDelivery) update.expectedDelivery = expectedDelivery;

  const deliveredAt = toDateOrNull(t?.deliveredAt);
  if (deliveredAt) update.deliveredAt = deliveredAt;

  const statusDate = toDateOrNull(t?.statusDate || latestEvent?.eventTime);

  if (normalizedStatus === "pickup_pending" && statusDate) {
    update.pickupScheduledAt = statusDate;
  }

  if (normalizedStatus === "picked" && statusDate) {
    update.pickedUpAt = statusDate;
  }

  if (["shipped", "in_transit"].includes(normalizedStatus) && statusDate) {
    update.shippedAt = statusDate;
  }

  if (normalizedStatus === "out_for_delivery" && statusDate) {
    update.outForDeliveryAt = statusDate;
  }

  if (normalizedStatus === "delivered" && statusDate) {
    update.deliveredAt = deliveredAt || statusDate;
  }

  if (normalizedStatus === "rto" && statusDate) {
    update.rtoAt = statusDate;
  }

  if (["failed", "exception"].includes(normalizedStatus) && statusDate) {
    update.failedAt = statusDate;
  }

  if (normalizedStatus === "cancelled") {
    update.isCancelled = true;
    update.cancelledAt = statusDate || new Date();
  }

  return update;
};

export const buildDirectCreateShipmentPayload = (shipment = {}, order = null) => {
  const sourceOrder = order || {};
const firstItem =
  sourceOrder?.items?.[0] ||
  {};

const productTitle =
  safe(firstItem?.productSnapshot?.title) ||
  safe(firstItem?.title) ||
  "Fashion Apparel";

  const declaredValue = positive(
    shipment?.declaredValue,
    getOrderDeclaredValue(sourceOrder)
  );

  const currency = safe(shipment?.currency || getOrderCurrency(sourceOrder)) || "INR";
  const isCod = safe(shipment?.paymentMode).toUpperCase() === "COD";

  const invoiceIsoDate = new Date(
    sourceOrder?.orderDate || sourceOrder?.createdAt || new Date()
  ).toISOString();

  const addressType = "residential";

  const shipperAddress = {
    contact_name: safe(shipment?.sender?.fullName),
    company_name: BLUEDART?.SENDER_COMPANY_NAME || "MIRAY",
    street1: safe(shipment?.sender?.line1),
    street2: safe(shipment?.sender?.line2),
    city: safe(shipment?.sender?.city),
    state: safe(shipment?.sender?.state),
    postal_code: safe(shipment?.sender?.pincode),
    phone: safe(shipment?.sender?.phone),
    email: safe(shipment?.sender?.email),
    tax_id: safe(process.env.ESHIPZ_GST_NUMBER || process.env.BLUEDART_GST_NUMBER || ""),
    country: countryToCode(shipment?.sender?.country),
    type: addressType,
  };

  const receiverAddress = {
    contact_name: safe(shipment?.recipient?.fullName),
    company_name: "",
    street1: safe(shipment?.recipient?.line1),
    street2: safe(shipment?.recipient?.line2),
    city: safe(shipment?.recipient?.city),
    state: safe(shipment?.recipient?.state),
    postal_code: safe(shipment?.recipient?.pincode),
    phone: safe(shipment?.recipient?.phone),
    email: safe(shipment?.recipient?.email),
    country: countryToCode(shipment?.recipient?.country),
    type: addressType,
  };

  const itemWeight = {
    value: getShipmentWeight(shipment),
    unit: "kg",
  };

  return {
    billing: {
      paid_by: "shipper",
    },

    vendor_id: BLUEDART?.VENDOR_ID || "",
description: productTitle,
    slug: BLUEDART?.CARRIER_SLUG || "bluedart",
    purpose: "commercial",
    order_source: "api",
parcel_contents: productTitle,
    is_document: false,

    service_type:
      safe(shipment?.serviceType) ||
      (isCod ? "eTailCODAir" : "eTailPrePaidAir"),

    charged_weight: {
      value: getShipmentWeight(shipment),
      unit: "kg",
    },

    customer_reference: safe(shipment?.referenceNumber || shipment?.orderNumber),
    invoice_number: safe(sourceOrder?.invoiceNumber || shipment?.orderNumber),
    invoice_date: invoiceIsoDate,

    is_cod: isCod,

    collect_on_delivery: {
      amount: isCod ? positive(shipment?.codAmount, declaredValue) : 0,
      currency,
    },

    shipment: {
      ship_from: shipperAddress,
      ship_to: receiverAddress,
      return_to: shipperAddress,

      is_reverse: false,
      is_to_pay: false,

      parcels: [
        {
description: productTitle,
          box_type: "custom",
          quantity: positive(shipment?.pieces, 1),
          weight: {
            value: getShipmentWeight(shipment),
            unit: "kg",
          },
          dimension: {
            width: getShipmentBreadth(shipment),
            height: getShipmentHeight(shipment),
            length: getShipmentLength(shipment),
            unit: "cm",
          },
          items: getOrderItemsForPayload(sourceOrder, shipment).map((item) => ({
            description: item.description,
            origin_country: "IN",
            sku: item.sku,
            hs_code: item.hs_code,
            variant: "",
            quantity: item.quantity,
            price: {
              amount: item?.value?.amount || declaredValue,
              currency,
            },
            weight: itemWeight,
          })),
        },
      ],
    },

    gst_invoices: [
      {
        invoice_number: safe(sourceOrder?.invoiceNumber || shipment?.orderNumber),
        invoice_date: invoiceIsoDate,
        invoice_value: declaredValue,
        ewaybill_number: "",
        ewaybill_date: "",
      },
    ],
  };
};

export const buildServiceabilityPayload = (
  shipment = {},
  order = null
) => {
  const sourceOrder = order || {};

  const isCod =
    safe(shipment?.paymentMode).toUpperCase() === "COD";

  return {
    is_document: false,

    shipment: {
      is_reverse: false,

      purpose: "commercial",

      is_cod: isCod,

      collect_on_delivery: {
        amount: isCod
          ? positive(
              shipment?.codAmount,
              getOrderDeclaredValue(sourceOrder)
            )
          : 0,

        currency:
          safe(
            shipment?.currency ||
              getOrderCurrency(sourceOrder)
          ) || "INR",
      },

      ship_from: {
        contact_name: safe(
          shipment?.sender?.fullName
        ),

        company_name:
          BLUEDART?.SENDER_COMPANY_NAME ||
          "MIRAY",

        street1: safe(
          shipment?.sender?.line1
        ),

        street2: safe(
          shipment?.sender?.line2
        ),

        city: safe(
          shipment?.sender?.city
        ),

        state: safe(
          shipment?.sender?.state
        ),

        postal_code: safe(
          shipment?.sender?.pincode
        ),

        country: countryToCode(
          shipment?.sender?.country
        ),

        type: "residential",

        phone: safe(
          shipment?.sender?.phone
        ),

        email: safe(
          shipment?.sender?.email
        ),
      },

      ship_to: {
        contact_name: safe(
          shipment?.recipient?.fullName
        ),

        company_name: "",

        street1: safe(
          shipment?.recipient?.line1
        ),

        street2: safe(
          shipment?.recipient?.line2
        ),

        city: safe(
          shipment?.recipient?.city
        ),

        state: safe(
          shipment?.recipient?.state
        ),

        postal_code: safe(
          shipment?.recipient?.pincode
        ),

        country: countryToCode(
          shipment?.recipient?.country
        ),

        type: "residential",

        phone: safe(
          shipment?.recipient?.phone
        ),

        email: safe(
          shipment?.recipient?.email
        ),
      },

      return_to: {
        contact_name: safe(
          shipment?.sender?.fullName
        ),

        company_name:
          BLUEDART?.SENDER_COMPANY_NAME ||
          "MIRAY",

        street1: safe(
          shipment?.sender?.line1
        ),

        street2: safe(
          shipment?.sender?.line2
        ),

        city: safe(
          shipment?.sender?.city
        ),

        state: safe(
          shipment?.sender?.state
        ),

        postal_code: safe(
          shipment?.sender?.pincode
        ),

        country: countryToCode(
          shipment?.sender?.country
        ),

        type: "residential",

        phone: safe(
          shipment?.sender?.phone
        ),

        email: safe(
          shipment?.sender?.email
        ),
      },

      parcels: [
        {
          description: "Fashion Products",

          box_type: "custom",

          weight: {
            value: getShipmentWeight(shipment),
            unit: "kg",
          },

          dimension: {
            width: getShipmentBreadth(shipment),

            height: getShipmentHeight(shipment),

            length: getShipmentLength(shipment),

            unit: "cm",
          },

          items: [
            {
              description: "Fashion Products",

              origin_country: "IN",

              quantity: 1,

              price: {
                amount: positive(
                  shipment?.declaredValue,
                  getOrderDeclaredValue(sourceOrder)
                ),

                currency:
                  safe(
                    shipment?.currency ||
                      getOrderCurrency(sourceOrder)
                  ) || "INR",
              },

              weight: {
                value: getShipmentWeight(shipment),
                unit: "kg",
              },
            },
          ],
        },
      ],
    },
  };
};

export { getDefaultSender };