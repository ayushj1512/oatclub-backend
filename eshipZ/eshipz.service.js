import axios from "axios";
import { ESHIPZ } from "./eshipz.constants.js";

const getHeaders = () => ({
  "Content-Type": "application/json",
  "X-API-TOKEN": ESHIPZ.API_TOKEN,
});

const cleanPhone = (phone) =>
  String(phone || "").replace(/\D/g, "").slice(-10);

const getInvoiceDate = () => new Date().toISOString();

const toEshipzShipmentPayload = (body) => {
  const isCOD = String(body.payment_method || "").toLowerCase() === "cod";

  const amount = Number(body.amount || 0);
  const weight = Number(body.weight || ESHIPZ.DEFAULTS.WEIGHT || 0.5);

  const items = Array.isArray(body.items) && body.items.length
    ? body.items
    : [
        {
          name: "Fashion product",
          sku: "",
          quantity: 1,
          price: amount,
        },
      ];

  const firstItem = items[0] || {};

  const shipper = ESHIPZ.PICKUP;

  return {
    billing: {
      paid_by: "shipper",
    },

    vendor_id: ESHIPZ.VENDOR_ID,

    description: ESHIPZ.CARRIER_NAME || "BlueDart",
    slug: ESHIPZ.CARRIER_SLUG || "bluedart",

    purpose: "commercial",
    order_source: "api",
    parcel_contents: firstItem.name || "Fashion product",
    is_document: false,

    service_type: isCOD
      ? ESHIPZ.SERVICE_TYPES.COD
      : ESHIPZ.SERVICE_TYPES.PREPAID,

    charged_weight: {
      unit: "KG",
      value: weight,
    },

    customer_reference: String(body.order_number || Date.now()),
    invoice_number: String(body.order_number || Date.now()),
    invoice_date: getInvoiceDate(),

    is_cod: isCOD,

    collect_on_delivery: {
      amount: isCOD ? amount : 0,
      currency: ESHIPZ.DEFAULTS.CURRENCY || "INR",
    },

    shipment: {
      ship_from: {
        ...shipper,
        phone: cleanPhone(shipper.phone),
      },

      ship_to: {
        contact_name: body.consignee_name || "Customer",
        company_name: body.consignee_name || "Customer",
        street1: body.consignee_address || "Address",
        street2: body.consignee_address2 || "",
        city: body.consignee_city || "",
        state: body.consignee_state || "",
        postal_code: String(body.consignee_pincode || ""),
        phone: cleanPhone(body.consignee_phone),
        country: "IN",
        type: "residential",
      },

      return_to: {
        ...shipper,
        phone: cleanPhone(shipper.phone),
      },

      is_reverse: false,
      is_to_pay: false,

      parcels: [
        {
          description: firstItem.name || "Fashion product",
          box_type: "custom",
          quantity: 1,

          weight: {
            value: weight,
            unit: "kg",
          },

          dimension: {
            width: Number(body.breadth || ESHIPZ.DEFAULTS.BREADTH || 20),
            height: Number(body.height || ESHIPZ.DEFAULTS.HEIGHT || 5),
            length: Number(body.length || ESHIPZ.DEFAULTS.LENGTH || 25),
            unit: "cm",
          },

          items: items.map((item) => ({
            description: item.name || "Product",
            origin_country: "IN",
            sku: String(item.sku || ""),
            hs_code: String(item.hs_code || ""),
            variant: String(item.variant || ""),
            quantity: Number(item.quantity || 1),

            price: {
              amount: Number(item.price || amount || 0),
              currency: ESHIPZ.DEFAULTS.CURRENCY || "INR",
            },

            weight: {
              value: weight,
              unit: "kg",
            },
          })),
        },
      ],
    },

    gst_invoices: [
      {
        invoice_number: String(body.order_number || Date.now()),
        invoice_date: getInvoiceDate(),
        invoice_value: amount,
        ewaybill_number: "",
        ewaybill_date: "",
      },
    ],
  };
};

const isEshipzFailedBody = (data) => {
  const status = Number(data?.status);

  const message = String(
    data?.remark ||
      data?.message ||
      data?.error?.message ||
      data?.error ||
      ""
  ).toLowerCase();

  return (
    status >= 400 ||
    message.includes("validation failed") ||
    message.includes("un-authorized") ||
    message.includes("unauthorized") ||
    message.includes("invalid")
  );
};

const postToEshipz = async (endpoint, payload) => {
  const url = `${ESHIPZ.BASE_URL}${endpoint}`;
  const eshipzPayload = toEshipzShipmentPayload(payload);

  console.log("🚚 eShipz request:", {
    url,
    order: payload?.order_number,
    tokenPresent: !!ESHIPZ.API_TOKEN,
  });

  const { data } = await axios.post(url, eshipzPayload, {
    headers: getHeaders(),
    timeout: ESHIPZ.TIMEOUT,
  });

  if (isEshipzFailedBody(data)) {
    const error = new Error(
      data?.error?.message ||
        data?.remark ||
        data?.message ||
        "eShipz request failed"
    );

    error.response = {
      status: Number(data?.status) || 400,
      data,
    };

    throw error;
  }

  return {
    response: data,
    sentPayload: eshipzPayload,
  };
};

export const createEshipzShipmentApi = async (payload) => {
  const endpoint = ESHIPZ.ENDPOINTS.CREATE_SHIPMENT;

  const result = await postToEshipz(endpoint, payload);

  return {
    endpoint,
    response: result.response,
    sentPayload: result.sentPayload,
  };
};