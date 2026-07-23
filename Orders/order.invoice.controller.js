// Orders/order.invoice.controller.js

import mongoose from "mongoose";
import Order from "./Orders.js";

/* ============================================================
   CONFIG
============================================================ */

const MAX_BULK_INVOICES = 250;

const SELLER = {
  name: process.env.INVOICE_SELLER_NAME || "OATCLUB",
  brand: process.env.INVOICE_BRAND_NAME || "OATCLUB",

  logo:
    process.env.INVOICE_LOGO_URL ||
    "https://res.cloudinary.com/dpsvrt4sd/image/upload/v1781123546/odb5ckquouajjzfbxin0.webp",

  signature: process.env.INVOICE_SIGNATURE_URL || "",

  address:
    process.env.INVOICE_SELLER_ADDRESS ||
    "REGISTERED BUSINESS ADDRESS AS PER GST",

  addressLine2: process.env.INVOICE_SELLER_ADDRESS_LINE_2 || "",
  city: process.env.INVOICE_SELLER_CITY || "New Delhi",
  state: process.env.INVOICE_SELLER_STATE || "Delhi",
  country: process.env.INVOICE_SELLER_COUNTRY || "India",
  pincode: process.env.INVOICE_SELLER_PINCODE || "",

  phone: process.env.INVOICE_SELLER_PHONE || "(+91) 7217649990",
  email: process.env.INVOICE_SELLER_EMAIL || "hey@oatclub.in",
  website: process.env.INVOICE_SELLER_WEBSITE || "https://www.oatclub.in",

  gstin: process.env.INVOICE_SELLER_GSTIN || "07BAGPN9548F1ZC",
  pan: process.env.INVOICE_SELLER_PAN || "BAGPN9548F",

  stateCode: process.env.INVOICE_SELLER_STATE_CODE || "07",
  defaultGst: Number(process.env.INVOICE_DEFAULT_GST || 5),
  currency: process.env.INVOICE_CURRENCY || "INR",
};

const PAYMENT_TITLE_MAP = {
  cod: "Cash on Delivery",
  razorpay: "Online Payment",
  prepaid: "Prepaid",
  exchange: "Exchange",
  wallet: "OATCLUB Wallet",
};

/* ============================================================
   BASIC HELPERS
============================================================ */

const safe = (value) => String(value ?? "").trim();

const toNum = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const roundMoney = (value) =>
  Math.round((toNum(value, 0) + Number.EPSILON) * 100) / 100;

const uniq = (values = []) =>
  [...new Set(values.map((value) => safe(value)).filter(Boolean))];

const compactObject = (object = {}) =>
  Object.fromEntries(
    Object.entries(object).filter(
      ([, value]) => value !== undefined && value !== null && value !== ""
    )
  );

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ============================================================
   ORDER NUMBER NORMALIZATION
============================================================ */

/**
 * Database currently generates padded numeric order numbers:
 * 000001, 000002...
 *
 * But admin may send:
 * 000001
 * SHOP-000001
 * #000001
 * shop-1
 * 1
 */
const normalizeOrderNumberKey = (value) => {
  let number = safe(value).toUpperCase();

  number = number
    .replace(/^#/, "")
    .replace(/^SHOP[-_\s]*/i, "")
    .replace(/^OATCLUB[-_\s]*/i, "")
    .trim();

  if (/^\d+$/.test(number)) {
    return String(Number(number));
  }

  return number;
};

const buildOrderNumberCandidates = (value) => {
  const raw = safe(value);
  const stripped = raw
    .replace(/^#/, "")
    .replace(/^SHOP[-_\s]*/i, "")
    .replace(/^OATCLUB[-_\s]*/i, "")
    .trim();

  const candidates = [raw, stripped];

  if (/^\d+$/.test(stripped)) {
    const numeric = String(Number(stripped));

    candidates.push(
      numeric,
      numeric.padStart(4, "0"),
      numeric.padStart(5, "0"),
      numeric.padStart(6, "0")
    );
  }

  return uniq(candidates);
};

/* ============================================================
   ATTRIBUTE / ITEM HELPERS
============================================================ */

const getAttributeValue = (attributes = [], keys = []) => {
  if (!Array.isArray(attributes)) return "";

  const wantedKeys = (Array.isArray(keys) ? keys : [keys]).map((key) =>
    safe(key).toLowerCase()
  );

  const attribute = attributes.find((item) =>
    wantedKeys.includes(safe(item?.key).toLowerCase())
  );

  return safe(attribute?.value);
};

const getItemSize = (item = {}) =>
  safe(
    item?.selectedSize ||
      item?.size ||
      item?.variant?.size ||
      getAttributeValue(item?.variant?.attributes, ["size", "sizes"])
  ) || "-";

const getItemColor = (item = {}) =>
  safe(
    item?.selectedColor ||
      item?.color ||
      item?.variant?.color ||
      getAttributeValue(item?.variant?.attributes, ["color", "colour"])
  );

const getItemTitle = (item = {}) =>
  safe(item?.productSnapshot?.title || item?.productId?.title) ||
  "Unnamed Product";

const getItemSku = (item = {}) =>
  safe(
    item?.productSnapshot?.sku ||
      item?.variant?.sku ||
      item?.sku ||
      item?.productSnapshot?.productCode
  );

const getItemHsn = (item = {}) =>
  safe(item?.productSnapshot?.hsnCode || item?.hsnCode);

const getItemThumbnail = (item = {}) =>
  safe(
    item?.productSnapshot?.thumbnail ||
      item?.productSnapshot?.images?.[0] ||
      item?.productId?.thumbnail ||
      item?.productId?.images?.[0]
  );

/* ============================================================
   ADDRESS HELPERS
============================================================ */

const buildAddress = (snapshot = {}, fallback = {}) => ({
  fullName:
    safe(snapshot?.fullName || fallback?.fullName || fallback?.name) || "-",

  line1: safe(snapshot?.line1 || fallback?.line1) || "-",
  line2: safe(snapshot?.line2 || fallback?.line2),

  city: safe(snapshot?.city || fallback?.city),
  state: safe(snapshot?.state || fallback?.state),
  country:
    safe(snapshot?.country || fallback?.country) || SELLER.country,
  pincode: safe(snapshot?.pincode || fallback?.pincode),

  phone: safe(snapshot?.phone || fallback?.phone),
  email: safe(snapshot?.email || fallback?.email),
});

const buildBillingAddress = (order = {}) =>
  buildAddress(order?.billingAddressSnapshot, {
    fullName: order?.customerId?.name,
    name: order?.customerId?.name,
    phone: order?.customerId?.phone,
    email: order?.customerId?.email,
  });

const buildShippingAddress = (order = {}, billing = {}) =>
  buildAddress(order?.shippingAddressSnapshot, billing);

/* ============================================================
   SHIPMENT HELPERS
============================================================ */

const getCourierName = (order = {}) =>
  safe(
    order?.shipment?.courierName ||
      order?.shipment?.shiprocket?.courierName ||
      order?.shipment?.xpressbees?.courierName ||
      order?.shipment?.eshipz?.courierName ||
      order?.trackingDetails?.courierName
  ) || "-";

const getAwb = (order = {}) =>
  safe(
    order?.shipment?.awb ||
      order?.shipment?.shiprocket?.awb ||
      order?.shipment?.xpressbees?.awb ||
      order?.shipment?.eshipz?.awb ||
      order?.trackingDetails?.awb ||
      order?.trackingDetails?.trackingId
  ) || "-";

const getTrackingUrl = (order = {}) =>
  safe(
    order?.shipment?.trackingUrl ||
      order?.shipment?.shiprocket?.trackingUrl ||
      order?.shipment?.xpressbees?.trackingUrl ||
      order?.shipment?.eshipz?.trackingUrl ||
      order?.trackingDetails?.trackingUrl
  );

const getLabelUrl = (order = {}) =>
  safe(
    order?.shipment?.labelUrl ||
      order?.shipment?.shiprocket?.labelUrl ||
      order?.shipment?.xpressbees?.labelUrl ||
      order?.shipment?.eshipz?.labelUrl
  );

/* ============================================================
   GST HELPERS
============================================================ */

/**
 * Item price is treated as GST inclusive.
 *
 * taxable value = gross / (1 + gstRate / 100)
 * tax amount    = gross - taxable value
 */
const calculateInclusiveTax = ({ price, quantity, gstRate }) => {
  const qty = Math.max(0, toNum(quantity));
  const unitPriceIncl = Math.max(0, toNum(price));
  const rate = Math.max(0, toNum(gstRate, SELLER.defaultGst));

  const grossAmount = roundMoney(unitPriceIncl * qty);

  if (!rate) {
    return {
      unitPriceIncl: roundMoney(unitPriceIncl),
      unitTaxableValue: roundMoney(unitPriceIncl),
      grossAmount,
      taxableValue: grossAmount,
      taxAmount: 0,
      cgstRate: 0,
      sgstRate: 0,
      igstRate: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
    };
  }

  const taxableValue = roundMoney(grossAmount / (1 + rate / 100));
  const taxAmount = roundMoney(grossAmount - taxableValue);

  return {
    unitPriceIncl: roundMoney(unitPriceIncl),
    unitTaxableValue: roundMoney(taxableValue / Math.max(qty, 1)),

    grossAmount,
    taxableValue,
    taxAmount,

    cgstRate: roundMoney(rate / 2),
    sgstRate: roundMoney(rate / 2),
    igstRate: rate,

    cgstAmount: roundMoney(taxAmount / 2),
    sgstAmount: roundMoney(taxAmount / 2),
    igstAmount: taxAmount,
  };
};

const isInterStateOrder = (shipping = {}) => {
  const sellerState = safe(SELLER.state).toLowerCase();
  const customerState = safe(shipping?.state).toLowerCase();

  if (!sellerState || !customerState) return false;

  return sellerState !== customerState;
};

/* ============================================================
   INVOICE NUMBER
============================================================ */

const buildInvoiceNumber = (order = {}) => {
  const storedInvoiceNumber = safe(order?.invoiceNumber);

  if (storedInvoiceNumber) return storedInvoiceNumber;

  const orderNumber = safe(order?.orderNumber);
  return orderNumber ? `INV-${orderNumber}` : "";
};

/* ============================================================
   NORMALIZE ORDER INTO INVOICE
============================================================ */

const normalizeInvoiceFromOrder = (order = {}) => {
  const billing = buildBillingAddress(order);
  const shipping = buildShippingAddress(order, billing);
  const interState = isInterStateOrder(shipping);

  const items = Array.isArray(order?.items)
    ? order.items.map((item, index) => {
        const qty = Math.max(0, toNum(item?.quantity));
        const priceIncl = Math.max(0, toNum(item?.price));

        const gstRate =
          toNum(item?.gstRate, SELLER.defaultGst) || SELLER.defaultGst;

        const tax = calculateInclusiveTax({
          price: priceIncl,
          quantity: qty,
          gstRate,
        });

        return {
          sr: index + 1,
          lineId: safe(item?.lineId),

          productId: safe(item?.productId?._id || item?.productId),
          productCode: safe(item?.productSnapshot?.productCode),

          name: getItemTitle(item),
          title: getItemTitle(item),

          sku: getItemSku(item),
          hsnCode: getItemHsn(item),

          size: getItemSize(item),
          selectedSize: getItemSize(item),
          color: getItemColor(item),
          selectedColor: getItemColor(item),

          image: getItemThumbnail(item),
          thumbnail: getItemThumbnail(item),

          qty,
          quantity: qty,

          price: priceIncl,
          priceIncl,

          compareAtPrice: toNum(item?.compareAtPrice, 0),
          lineSubtotal: roundMoney(
            toNum(item?.subtotal, priceIncl * qty)
          ),

          gstRate,

          taxableValue: tax.taxableValue,
          taxAmount: tax.taxAmount,
          grossAmount: tax.grossAmount,

          unitPriceIncl: tax.unitPriceIncl,
          unitTaxableValue: tax.unitTaxableValue,

          cgstRate: interState ? 0 : tax.cgstRate,
          sgstRate: interState ? 0 : tax.sgstRate,
          igstRate: interState ? tax.igstRate : 0,

          cgstAmount: interState ? 0 : tax.cgstAmount,
          sgstAmount: interState ? 0 : tax.sgstAmount,
          igstAmount: interState ? tax.igstAmount : 0,
        };
      })
    : [];

  const calculatedItemsGross = roundMoney(
    items.reduce((sum, item) => sum + toNum(item?.grossAmount), 0)
  );

  const calculatedTaxable = roundMoney(
    items.reduce((sum, item) => sum + toNum(item?.taxableValue), 0)
  );

  const calculatedTax = roundMoney(
    items.reduce((sum, item) => sum + toNum(item?.taxAmount), 0)
  );

  const subtotal = roundMoney(
    toNum(order?.subtotal, calculatedItemsGross)
  );

  const discount = roundMoney(
    toNum(order?.discount ?? order?.coupon?.discount, 0)
  );

  const shippingFee = roundMoney(toNum(order?.shippingFee, 0));

  const finalPayable = roundMoney(
    toNum(
      order?.finalPayable,
      Math.max(0, subtotal + shippingFee - discount)
    )
  );

  const storedTax = roundMoney(toNum(order?.tax, 0));

  return {
    id: safe(order?._id),
    orderId: safe(order?._id),

    orderNumber: safe(order?.orderNumber),
    invoiceNumber: buildInvoiceNumber(order),

    orderDate: order?.orderDate || order?.createdAt || null,
    invoiceDate: order?.orderDate || order?.createdAt || null,
    createdAt: order?.createdAt || null,

    seller: {
      ...SELLER,
      fullAddress: [
        SELLER.address,
        SELLER.addressLine2,
        SELLER.city,
        SELLER.state,
        SELLER.pincode,
        SELLER.country,
      ]
        .filter(Boolean)
        .join(", "),
    },

    customer: {
      name: billing.fullName,
      phone: billing.phone || shipping.phone,
      email: billing.email || shipping.email,
    },

    billing,
    billingAddress: billing,

    shipping,
    shippingAddress: shipping,

    placeOfSupply: shipping.state || billing.state || "-",
    taxType: interState ? "IGST" : "CGST_SGST",
    isInterState: interState,

    courier: {
      provider: safe(order?.shipment?.provider),
      name: getCourierName(order),
      courierName: getCourierName(order),

      awb: getAwb(order),
      trackingId: getAwb(order),

      trackingUrl: getTrackingUrl(order),
      labelUrl: getLabelUrl(order),

      status:
        safe(
          order?.shipment?.status ||
            order?.trackingDetails?.status ||
            order?.fulfillmentStatus
        ) || "-",
    },

    items,

    totals: {
      itemCount: items.length,
      totalQuantity: items.reduce(
        (sum, item) => sum + toNum(item?.quantity),
        0
      ),

      subtotal,
      itemsGross: calculatedItemsGross,

      taxable: calculatedTaxable,
      taxableValue: calculatedTaxable,

      calculatedTax,
      storedTax,
      tax: storedTax || calculatedTax,

      cgst: interState ? 0 : roundMoney(calculatedTax / 2),
      sgst: interState ? 0 : roundMoney(calculatedTax / 2),
      igst: interState ? calculatedTax : 0,

      discount,
      shippingFee,

      totalAmount: roundMoney(
        toNum(order?.totalAmount, subtotal + shippingFee)
      ),

      grandTotal: finalPayable,
      finalPayable,

      couponCode: safe(order?.coupon?.code),
      currency: safe(order?.currency) || SELLER.currency,
    },

    payment: {
      title:
        PAYMENT_TITLE_MAP[
          safe(order?.paymentMethod).toLowerCase()
        ] ||
        safe(order?.paymentMethod) ||
        "-",

      method: safe(order?.paymentMethod),
      status: safe(order?.paymentStatus),

      walletAmount: toNum(order?.paymentBreakdown?.walletAmount),
      razorpayAmount: toNum(order?.paymentBreakdown?.razorpayAmount),
      codAmount: toNum(order?.paymentBreakdown?.codAmount),
    },

    status: {
      fulfillment: safe(order?.fulfillmentStatus),
      shipment: safe(order?.shipment?.status),
      payment: safe(order?.paymentStatus),

      isConfirmed: Boolean(order?.isConfirmed),
      isPackable: Boolean(order?.isPackable),
      isCancelled:
        Boolean(order?.cancellation?.isCancelled) ||
        safe(order?.fulfillmentStatus) === "cancelled",
    },

    raw: {
      source: safe(order?.source),
      orderType: safe(order?.orderType),
      parentOrderId: safe(order?.parentOrderId),
      splitSuffix: safe(order?.splitSuffix),
    },
  };
};

/* ============================================================
   DATABASE QUERY
============================================================ */

const INVOICE_SELECT = {
  _id: 1,

  orderNumber: 1,
  invoiceNumber: 1,
  orderDate: 1,
  createdAt: 1,

  source: 1,
  orderType: 1,
  parentOrderId: 1,
  splitSuffix: 1,

  paymentMethod: 1,
  paymentStatus: 1,
  paymentBreakdown: 1,

  fulfillmentStatus: 1,
  fulfillmentDates: 1,

  isConfirmed: 1,
  isPackable: 1,
  cancellation: 1,

  subtotal: 1,
  discount: 1,
  shippingFee: 1,
  tax: 1,
  totalAmount: 1,
  finalPayable: 1,
  currency: 1,

  coupon: 1,

  billingAddressSnapshot: 1,
  shippingAddressSnapshot: 1,

  shipment: 1,
  trackingDetails: 1,

  items: 1,
  customerId: 1,
};

const INVOICE_POPULATE = [
  {
    path: "customerId",
    select: "name email phone",
  },
  {
    path: "items.productId",
    select: "title productCode thumbnail images",
  },
];

async function fetchOrdersForInvoice(filter = {}, options = {}) {
  const sort = options?.sort || { createdAt: -1 };
  const limit = Math.min(
    Math.max(toNum(options?.limit, MAX_BULK_INVOICES), 1),
    MAX_BULK_INVOICES
  );

  return Order.find(filter)
    .select(INVOICE_SELECT)
    .populate(INVOICE_POPULATE)
    .sort(sort)
    .limit(limit)
    .lean();
}

/* ============================================================
   REQUEST HELPERS
============================================================ */

const getRequestedOrderNumbers = (req = {}) => {
  const bodyOrderNumbers = Array.isArray(req.body?.orderNumbers)
    ? req.body.orderNumbers
    : [];

  const bodyOrders = Array.isArray(req.body?.orders)
    ? req.body.orders
    : [];

  const bodySingle = safe(req.body?.orderNumber)
    ? [req.body.orderNumber]
    : [];

  const queryOrderNumbers =
    typeof req.query?.orderNumbers === "string"
      ? req.query.orderNumbers.split(",")
      : [];

  return uniq([
    ...bodyOrderNumbers,
    ...bodyOrders,
    ...bodySingle,
    ...queryOrderNumbers,
  ]);
};

const buildInvoiceResponse = ({
  requestedOrderNumbers = [],
  orders = [],
}) => {
  const orderMap = new Map();

  orders.forEach((order) => {
    const key = normalizeOrderNumberKey(order?.orderNumber);

    if (key && !orderMap.has(key)) {
      orderMap.set(key, order);
    }
  });

  const invoices = [];
  const missingOrderNumbers = [];

  requestedOrderNumbers.forEach((requestedNumber) => {
    const key = normalizeOrderNumberKey(requestedNumber);
    const order = orderMap.get(key);

    if (!order) {
      missingOrderNumbers.push(requestedNumber);
      return;
    }

    invoices.push(normalizeInvoiceFromOrder(order));
  });

  return {
    invoices,
    missingOrderNumbers,
    foundOrderNumbers: invoices.map((invoice) => invoice.orderNumber),
  };
};

/* ============================================================
   CONTROLLERS
============================================================ */

/**
 * POST /api/orders/invoices
 *
 * Body:
 * {
 *   "orderNumbers": ["000001", "SHOP-000002", "#000003"]
 * }
 */
export const getInvoicesByOrderNumbers = async (req, res) => {
  try {
    const requestedOrderNumbers = getRequestedOrderNumbers(req);

    if (!requestedOrderNumbers.length) {
      return res.status(400).json({
        ok: false,
        message: "At least one order number is required",
        example: {
          orderNumbers: ["000001", "000002"],
        },
      });
    }

    if (requestedOrderNumbers.length > MAX_BULK_INVOICES) {
      return res.status(400).json({
        ok: false,
        message: `Maximum ${MAX_BULK_INVOICES} invoices can be fetched at once`,
      });
    }

    const allCandidates = uniq(
      requestedOrderNumbers.flatMap(buildOrderNumberCandidates)
    );

    const exactRegexes = allCandidates.map(
      (candidate) =>
        new RegExp(`^${escapeRegex(candidate)}$`, "i")
    );

    const orders = await fetchOrdersForInvoice(
      {
        orderNumber: {
          $in: exactRegexes,
        },
      },
      {
        limit: requestedOrderNumbers.length * 4,
      }
    );

    const result = buildInvoiceResponse({
      requestedOrderNumbers,
      orders,
    });

    return res.status(200).json({
      ok: true,

      requestedCount: requestedOrderNumbers.length,
      count: result.invoices.length,
      missingCount: result.missingOrderNumbers.length,

      requestedOrderNumbers,
      foundOrderNumbers: result.foundOrderNumbers,
      missingOrderNumbers: result.missingOrderNumbers,

      seller: SELLER,
      invoices: result.invoices,
    });
  } catch (error) {
    console.error("getInvoicesByOrderNumbers error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to fetch invoices",
      error: error.message,
    });
  }
};

/**
 * GET /api/orders/:id/invoice
 */
export const getInvoiceById = async (req, res) => {
  try {
    const id = safe(req.params?.id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid order id",
      });
    }

    const orders = await fetchOrdersForInvoice(
      { _id: id },
      { limit: 1 }
    );

    const order = orders[0];

    if (!order) {
      return res.status(404).json({
        ok: false,
        message: "Order not found",
      });
    }

    return res.status(200).json({
      ok: true,
      invoice: normalizeInvoiceFromOrder(order),
    });
  } catch (error) {
    console.error("getInvoiceById error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to fetch invoice",
      error: error.message,
    });
  }
};

/**
 * GET /api/orders/by-number/:orderNumber/invoice
 */
export const getInvoiceByOrderNumber = async (req, res) => {
  try {
    const requestedOrderNumber = safe(req.params?.orderNumber);

    if (!requestedOrderNumber) {
      return res.status(400).json({
        ok: false,
        message: "Order number is required",
      });
    }

    const candidates = buildOrderNumberCandidates(requestedOrderNumber);

    const regexes = candidates.map(
      (candidate) =>
        new RegExp(`^${escapeRegex(candidate)}$`, "i")
    );

    const orders = await fetchOrdersForInvoice(
      {
        orderNumber: {
          $in: regexes,
        },
      },
      { limit: 10 }
    );

    const requestedKey = normalizeOrderNumberKey(requestedOrderNumber);

    const order =
      orders.find(
        (item) =>
          normalizeOrderNumberKey(item?.orderNumber) === requestedKey
      ) || orders[0];

    if (!order) {
      return res.status(404).json({
        ok: false,
        message: "Order not found",
        orderNumber: requestedOrderNumber,
      });
    }

    return res.status(200).json({
      ok: true,
      invoice: normalizeInvoiceFromOrder(order),
    });
  } catch (error) {
    console.error("getInvoiceByOrderNumber error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to fetch invoice",
      error: error.message,
    });
  }
};

/**
 * GET /api/orders/invoices/recent
 *
 * Query:
 * ?limit=50
 * ?fulfillmentStatus=packed
 * ?paymentStatus=paid
 * ?from=2026-07-01
 * ?to=2026-07-31
 */
export const getRecentInvoices = async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(toNum(req.query?.limit, 50), 1),
      MAX_BULK_INVOICES
    );

    const filter = {};

    if (safe(req.query?.fulfillmentStatus)) {
      filter.fulfillmentStatus = safe(req.query.fulfillmentStatus);
    }

    if (safe(req.query?.paymentStatus)) {
      filter.paymentStatus = safe(req.query.paymentStatus);
    }

    if (safe(req.query?.paymentMethod)) {
      filter.paymentMethod = safe(req.query.paymentMethod);
    }

    const from = safe(req.query?.from);
    const to = safe(req.query?.to);

    if (from || to) {
      filter.orderDate = {};

      if (from) {
        const fromDate = new Date(from);

        if (!Number.isNaN(fromDate.getTime())) {
          fromDate.setHours(0, 0, 0, 0);
          filter.orderDate.$gte = fromDate;
        }
      }

      if (to) {
        const toDate = new Date(to);

        if (!Number.isNaN(toDate.getTime())) {
          toDate.setHours(23, 59, 59, 999);
          filter.orderDate.$lte = toDate;
        }
      }

      if (!Object.keys(filter.orderDate).length) {
        delete filter.orderDate;
      }
    }

    const orders = await fetchOrdersForInvoice(filter, {
      limit,
      sort: { orderDate: -1, createdAt: -1 },
    });

    const invoices = orders.map(normalizeInvoiceFromOrder);

    return res.status(200).json({
      ok: true,
      count: invoices.length,
      filters: compactObject({
        fulfillmentStatus: req.query?.fulfillmentStatus,
        paymentStatus: req.query?.paymentStatus,
        paymentMethod: req.query?.paymentMethod,
        from,
        to,
      }),
      invoices,
    });
  } catch (error) {
    console.error("getRecentInvoices error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to fetch recent invoices",
      error: error.message,
    });
  }
};

export default {
  getInvoicesByOrderNumbers,
  getInvoiceById,
  getInvoiceByOrderNumber,
  getRecentInvoices,
};