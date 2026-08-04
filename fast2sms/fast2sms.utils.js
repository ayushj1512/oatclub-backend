import { FAST2SMS_CONFIG } from "./fast2sms.config.js";

export const cleanPhone = (value = "") =>
  String(value).replace(/\D/g, "");

export const normalizeIndianPhone = (value = "") => {
  let phone = cleanPhone(value);

  if (phone.startsWith("91") && phone.length === 12) {
    phone = phone.slice(2);
  }

  if (phone.startsWith("0") && phone.length === 11) {
    phone = phone.slice(1);
  }

  if (phone.length !== 10) {
    throw new Error("A valid 10-digit Indian phone number is required");
  }

  return phone;
};

export const normalizeOrderNumber = (value = "") =>
  String(value).replace(/^#/, "").trim();

export const normalizeAmount = (value = "") =>
  String(value)
    .replace(/[₹,\s]/g, "")
    .trim();

export const buildOrderActionLink = (orderNumber) => {
  const normalizedOrderNumber = normalizeOrderNumber(orderNumber);

  if (!normalizedOrderNumber) {
    throw new Error("Order number is required");
  }

  return `https://www.oatclub.in/orders/action/${encodeURIComponent(
    normalizedOrderNumber
  )}`;
};

export const getOrderPhone = (order = {}) =>
  order?.shippingAddressSnapshot?.phone ||
  order?.shippingAddress?.phone ||
  order?.customerId?.phone ||
  order?.customer?.phone ||
  "";

export const getOrderCustomerName = (order = {}) =>
  order?.shippingAddressSnapshot?.fullName ||
  order?.shippingAddress?.fullName ||
  order?.customerId?.name ||
  order?.customer?.name ||
  "Customer";

export const getOrderNumber = (order = {}) =>
  normalizeOrderNumber(
    order?.orderNumber ||
    order?.displayOrderNumber ||
    order?._id ||
    ""
  );

export const getOrderTotal = (order = {}) =>
  normalizeAmount(
    order?.finalAmount ??
    order?.totalAmount ??
    order?.grandTotal ??
    order?.total ??
    ""
  );

export const getOrderItemSummary = (order = {}) => {
  const items = Array.isArray(order?.items) ? order.items : [];

  if (!items.length) {
    return "OATCLUB order";
  }

  return items
    .slice(0, 3)
    .map((item) => {
      const name =
        item?.productName ||
        item?.name ||
        item?.productSnapshot?.name ||
        "Product";

      const size = item?.size ? ` (${item.size})` : "";
      const quantity = Number(item?.quantity || 1);

      return `${name}${size} x${quantity}`;
    })
    .join(", ");
};

export const joinTemplateVariables = (variables = []) => {
  return variables
    .map((value) => {
      const normalizedValue = String(value ?? "").trim();

      if (!normalizedValue) {
        throw new Error("Fast2SMS template variable cannot be empty");
      }

      if (normalizedValue.includes("|")) {
        throw new Error(
          "Fast2SMS template variable cannot contain pipe character"
        );
      }

      return normalizedValue;
    })
    .join("|");
};

export const assertFast2SMSReady = () => {
  if (!FAST2SMS_CONFIG.API_KEY) {
    throw new Error("FAST2SMS_API_KEY is missing");
  }

  if (!FAST2SMS_CONFIG.PHONE_NUMBER_ID) {
    throw new Error("FAST2SMS_PHONE_NUMBER_ID is missing");
  }
};
