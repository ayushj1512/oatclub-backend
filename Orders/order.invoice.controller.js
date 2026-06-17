// Orders/order.invoice.controller.js

import mongoose from "mongoose";
import Order from "./Orders.js";

/* ============================================================
   HELPERS
============================================================ */

const safe = (v) => String(v ?? "").trim();

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const uniq = (arr = []) => [...new Set(arr.filter(Boolean))];

const paymentTitleMap = {
  cod: "Cash on Delivery",
  razorpay: "Online Payment",
  prepaid: "Prepaid",
  exchange: "Exchange",
};

const SELLER = {
  name: "OATCLUB",
  brand: "OATCLUB",

  logo:
    "http://res.cloudinary.com/dpsvrt4sd/image/upload/v1781123546/odb5ckquouajjzfbxin0.webp",
  signature: "",

  address: "REGISTERED BUSINESS ADDRESS AS PER GST",
  city: "New Delhi",
  state: "Delhi",
  country: "India",
  pincode: "",

  phone: "(+91) 7217649990",
  email: "hey@oatclub.in",
  website: "https://www.oatclub.in/",

  gstin: "07BAGPN9548F1ZC",
  pan: "BAGPN9548F",

  defaultGst: 5,
  currency: "INR",
};

const getAttrValue = (attrs = [], key = "") => {
  if (!Array.isArray(attrs) || !key) return "";
  const wanted = String(key).trim().toLowerCase();
  const hit = attrs.find(
    (a) => String(a?.key || "").trim().toLowerCase() === wanted
  );
  return safe(hit?.value);
};

const getItemSize = (it = {}) =>
  safe(
    it?.selectedSize ||
      it?.size ||
      it?.variant?.size ||
      getAttrValue(it?.variant?.attributes, "size")
  ) || "-";

const getCourierName = (order = {}) =>
  safe(
    order?.shipment?.shiprocket?.courierName ||
      order?.trackingDetails?.courierName
  ) || "-";

const getAwb = (order = {}) =>
  safe(order?.shipment?.shiprocket?.awb || order?.trackingDetails?.trackingId) ||
  "-";

const buildBilling = (order = {}) => ({
  fullName:
    safe(order?.billingAddressSnapshot?.fullName) ||
    safe(order?.customerId?.name) ||
    "-",
  line1: safe(order?.billingAddressSnapshot?.line1) || "-",
  line2: safe(order?.billingAddressSnapshot?.line2),
  city: safe(order?.billingAddressSnapshot?.city),
  pincode: safe(order?.billingAddressSnapshot?.pincode),
  state: safe(order?.billingAddressSnapshot?.state),
  phone:
    safe(order?.billingAddressSnapshot?.phone) ||
    safe(order?.customerId?.phone),
  email:
    safe(order?.billingAddressSnapshot?.email) ||
    safe(order?.customerId?.email),
});

const buildShipping = (order = {}, billing = {}) => ({
  fullName:
    safe(order?.shippingAddressSnapshot?.fullName) ||
    safe(billing?.fullName) ||
    "-",
  line1:
    safe(order?.shippingAddressSnapshot?.line1) ||
    safe(billing?.line1) ||
    "-",
  line2: safe(order?.shippingAddressSnapshot?.line2) || safe(billing?.line2),
  city: safe(order?.shippingAddressSnapshot?.city) || safe(billing?.city),
  pincode:
    safe(order?.shippingAddressSnapshot?.pincode) || safe(billing?.pincode),
  state: safe(order?.shippingAddressSnapshot?.state) || safe(billing?.state),
  phone: safe(order?.shippingAddressSnapshot?.phone) || safe(billing?.phone),
  email: safe(order?.shippingAddressSnapshot?.email) || safe(billing?.email),
});

const normalizeInvoiceFromOrder = (order = {}) => {
  const billing = buildBilling(order);
  const shipping = buildShipping(order, billing);

  const items = Array.isArray(order?.items)
    ? order.items.map((it, idx) => ({
        sr: idx + 1,
        name:
          safe(it?.productSnapshot?.title) ||
          safe(it?.productId?.title) ||
          "Unnamed Product",

        qty: toNum(it?.quantity, 0),
        priceIncl: toNum(it?.price, 0),
        gstRate: toNum(it?.gstRate, SELLER.defaultGst) || SELLER.defaultGst,

        size: getItemSize(it),
        selectedSize: getItemSize(it),

        hsnCode:
          safe(it?.productSnapshot?.hsnCode) || safe(it?.hsnCode) || "",

        sku:
          safe(it?.productSnapshot?.sku) ||
          safe(it?.variant?.sku) ||
          safe(it?.sku),
      }))
    : [];

  return {
    seller: SELLER,

    orderId: String(order?._id || ""),
    orderNumber: safe(order?.orderNumber),
    orderDate: order?.orderDate || order?.createdAt || null,
    invoiceNumber: safe(order?.invoiceNumber || order?.orderNumber),

    billing,
    shipping,

    courier: {
      name: getCourierName(order),
      awb: getAwb(order),
    },

    items,

    totals: {
      taxable: toNum(order?.subtotal, 0),
      tax: toNum(order?.tax, 0),
      grandTotal: toNum(order?.finalPayable, 0),
      discount: toNum(order?.discount ?? order?.coupon?.discount, 0),
      couponCode: safe(order?.coupon?.code),
      finalPayable: toNum(order?.finalPayable, 0),
      shippingFee: toNum(order?.shippingFee, 0),
      currency: safe(order?.currency) || SELLER.currency,
    },

    payment: {
      title:
        paymentTitleMap[String(order?.paymentMethod || "").trim().toLowerCase()] ||
        safe(order?.paymentMethod) ||
        "-",
      method: safe(order?.paymentMethod),
      status: safe(order?.paymentStatus),
    },

    raw: {
      fulfillmentStatus: safe(order?.fulfillmentStatus),
      isConfirmed: !!order?.isConfirmed,
    },
  };
};

/* ============================================================
   COMMON QUERY
============================================================ */

const INVOICE_SELECT = {
  _id: 1,
  orderNumber: 1,
  invoiceNumber: 1,
  createdAt: 1,
  orderDate: 1,

  paymentMethod: 1,
  paymentStatus: 1,
  fulfillmentStatus: 1,
  isConfirmed: 1,

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

const INVOICE_POPULATE = {
  path: "customerId",
  select: "name email phone",
};

async function fetchOrdersForInvoice(filter = {}) {
  return Order.find(filter)
    .select(INVOICE_SELECT)
    .populate(INVOICE_POPULATE)
    .lean();
}

/* ============================================================
   CONTROLLERS
============================================================ */

export const getInvoicesByOrderNumbers = async (req, res) => {
  try {
    const bodyOrderNumbers = Array.isArray(req.body?.orderNumbers)
      ? req.body.orderNumbers
      : [];

    const queryOrderNumbers =
      typeof req.query?.orderNumbers === "string"
        ? req.query.orderNumbers.split(",")
        : [];

    const orderNumbers = uniq(
      [...bodyOrderNumbers, ...queryOrderNumbers].map((v) => safe(v))
    );

    if (!orderNumbers.length) {
      return res.status(400).json({
        ok: false,
        message: "orderNumbers is required",
      });
    }

    const orders = await fetchOrdersForInvoice({
      orderNumber: { $in: orderNumbers },
    });

    const byOrderNumber = new Map(orders.map((o) => [safe(o?.orderNumber), o]));

    const invoices = orderNumbers
      .map((orderNumber) => {
        const order = byOrderNumber.get(orderNumber);
        if (!order) return null;
        return normalizeInvoiceFromOrder(order);
      })
      .filter(Boolean);

    const foundOrderNumbers = invoices.map((x) => safe(x?.orderNumber));
    const missingOrderNumbers = orderNumbers.filter(
      (x) => !foundOrderNumbers.includes(x)
    );

    return res.status(200).json({
      ok: true,
      count: invoices.length,
      requestedCount: orderNumbers.length,
      requestedOrderNumbers: orderNumbers,
      foundOrderNumbers,
      missingOrderNumbers,
      invoices,
    });
  } catch (error) {
    console.error("getInvoicesByOrderNumbers error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: error.message,
    });
  }
};

export const getInvoiceById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({
        ok: false,
        message: "Invalid order id",
      });
    }

    const orders = await fetchOrdersForInvoice({ _id: id });
    const order = orders?.[0];

    if (!order) {
      return res.status(404).json({
        ok: false,
        message: "Order not found",
      });
    }

    const invoice = normalizeInvoiceFromOrder(order);

    return res.status(200).json({
      ok: true,
      invoice,
    });
  } catch (error) {
    console.error("getInvoiceById error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: error.message,
    });
  }
};

export const getInvoiceByOrderNumber = async (req, res) => {
  try {
    const orderNumber = safe(req.params?.orderNumber);

    if (!orderNumber) {
      return res.status(400).json({
        ok: false,
        message: "orderNumber is required",
      });
    }

    const orders = await fetchOrdersForInvoice({ orderNumber });
    const order = orders?.[0];

    if (!order) {
      return res.status(404).json({
        ok: false,
        message: "Order not found",
      });
    }

    const invoice = normalizeInvoiceFromOrder(order);

    return res.status(200).json({
      ok: true,
      invoice,
    });
  } catch (error) {
    console.error("getInvoiceByOrderNumber error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: error.message,
    });
  }
};

export default {
  getInvoicesByOrderNumbers,
  getInvoiceById,
  getInvoiceByOrderNumber,
};