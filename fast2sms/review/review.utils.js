import { FAST2SMS_REVIEW_CONFIG } from "./review.config.js";

export const buildReviewLink = (orderNumber) => {
  const baseUrl = String(FAST2SMS_REVIEW_CONFIG.CLIENT_URL || "")
    .replace(/\/+$/, "");

  return `${baseUrl}/reviews/add?order=${encodeURIComponent(orderNumber)}`;
};

export const getReviewCustomerName = (order) =>
  order?.shippingAddressSnapshot?.fullName ||
  order?.shippingAddress?.fullName ||
  order?.customerId?.name ||
  order?.customer?.name ||
  "Customer";

export const getReviewPhone = (order) =>
  order?.shippingAddressSnapshot?.phone ||
  order?.shippingAddress?.phone ||
  order?.customerId?.phone ||
  order?.customer?.phone;

export const getReviewProductSummary = (order) => {
  const items = order?.items || [];

  if (!items.length) return "your recent purchase";

  const getTitle = (item) =>
    item?.productSnapshot?.title ||
    item?.productName ||
    item?.name ||
    item?.title ||
    "your product";

  if (items.length === 1) return getTitle(items[0]);

  return `${getTitle(items[0])} + ${items.length - 1} more item${
    items.length - 1 > 1 ? "s" : ""
  }`;
};