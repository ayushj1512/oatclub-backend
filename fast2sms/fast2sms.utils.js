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
    throw new Error(
      "A valid 10-digit Indian phone number is required",
    );
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
  const normalizedOrderNumber =
    normalizeOrderNumber(orderNumber);

  if (!normalizedOrderNumber) {
    throw new Error("Order number is required");
  }

  return `https://www.oatclub.in/orders/action/${encodeURIComponent(
    normalizedOrderNumber,
  )}`;
};

export const getOrderPhone = (order = {}) =>
  order?.shippingAddressSnapshot?.phone ||
  order?.billingAddressSnapshot?.phone ||
  order?.shippingAddress?.phone ||
  order?.customerId?.phone ||
  order?.customer?.phone ||
  order?.phone ||
  "";

export const getOrderCustomerName = (order = {}) =>
  order?.shippingAddressSnapshot?.fullName ||
  order?.billingAddressSnapshot?.fullName ||
  order?.shippingAddress?.fullName ||
  order?.customerId?.name ||
  order?.customer?.name ||
  "Customer";

export const getOrderNumber = (order = {}) =>
  normalizeOrderNumber(
    order?.orderNumber ||
    order?.displayOrderNumber ||
    order?._id ||
    "",
  );

export const getOrderTotal = (order = {}) =>
  normalizeAmount(
    order?.finalPayable ??
    order?.finalAmount ??
    order?.totalAmount ??
    order?.grandTotal ??
    order?.total ??
    "",
  );

export const getOrderItemSummary = (order = {}) => {
  const items = Array.isArray(order?.items)
    ? order.items
    : [];

  if (!items.length) {
    return "OATCLUB order";
  }

  const visibleItems = items
    .slice(0, 3)
    .map((item) => {
      const name =
        item?.productSnapshot?.title ||
        item?.productSnapshot?.name ||
        item?.productName ||
        item?.name ||
        "Product";

      const selectedSize =
        item?.selectedSize ||
        item?.size ||
        item?.variant?.size ||
        "";

      const size = selectedSize
        ? ` (${selectedSize})`
        : "";

      const quantity = Math.max(
        1,
        Number(item?.quantity || 1),
      );

      return `${name}${size} x${quantity}`;
    });

  const remaining =
    items.length - visibleItems.length;

  if (remaining > 0) {
    visibleItems.push(
      `+${remaining} more item${remaining > 1 ? "s" : ""
      }`,
    );
  }

  return visibleItems.join(", ");
};

export const joinTemplateVariables = (
  variables = [],
) =>
  variables
    .map((value) => {
      const normalizedValue = String(
        value ?? "",
      ).trim();

      if (!normalizedValue) {
        throw new Error(
          "Fast2SMS template variable cannot be empty",
        );
      }

      if (normalizedValue.includes("|")) {
        throw new Error(
          "Fast2SMS template variable cannot contain pipe character",
        );
      }

      return normalizedValue;
    })
    .join("|");

export const assertFast2SMSReady = () => {
  if (!FAST2SMS_CONFIG.API_KEY) {
    throw new Error("FAST2SMS_API_KEY is missing");
  }

  if (!FAST2SMS_CONFIG.PHONE_NUMBER_ID) {
    throw new Error(
      "FAST2SMS_PHONE_NUMBER_ID is missing",
    );
  }
};

export const parseFast2SMSWebhook = (
  payload = {},
) => ({
  requestId:
    payload.request_id ||
    payload.requestId ||
    "",

  messageId:
    payload.message_id ||
    payload.messageId ||
    "",

  status:
    payload.status ||
    payload.event ||
    "",

  phone:
    payload.mobile ||
    payload.phone ||
    "",

  message:
    payload.message ||
    payload.text ||
    "",

  raw: payload,
});
