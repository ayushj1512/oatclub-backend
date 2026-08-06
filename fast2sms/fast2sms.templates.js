const clean = (value, fallback = "") =>
  String(value ?? fallback).trim();

const cleanAmount = (value) =>
  String(value ?? "")
    .replace(/[₹,\s]/g, "")
    .trim();

export const FAST2SMS_TEMPLATES = Object.freeze({
  COD_ORDER_CONFIRMATION: {
    key: "COD_ORDER_CONFIRMATION",
    messageId: 26698,
    templateId: "1213076770865345",
    templateName: "order_confirmation_template",
    language: "en",
    status: "APPROVED",

    buildVariables: ({
      customerName,
      orderNumber,
      actionLink,
    } = {}) => [
        clean(orderNumber),
        clean(customerName, "Customer"),
        clean(orderNumber),
        clean(actionLink),
      ],
  },

  PAYMENT_PENDING: {
    key: "PAYMENT_PENDING",
    messageId: 27720,
    templateId: "1530769508357031",
    templateName: "order_payment_pending",
    language: "en",
    status: "APPROVED",

    buildVariables: ({
      customerName,
      orderNumber,
      paymentStatus,
      amount,
    } = {}) => [
        clean(customerName, "Customer"),
        clean(orderNumber),
        clean(paymentStatus, "Pending"),
        cleanAmount(amount),
      ],
  },

  PREPAID_ORDER_CONFIRMATION: {
    key: "PREPAID_ORDER_CONFIRMATION",
    messageId: 27584,
    templateId: "907733405161574",
    templateName: "order_paid_confirmation",
    language: "en",
    status: "APPROVED",

    buildVariables: ({
      customerName,
      orderNumber,
      itemSummary,
      amount,
    } = {}) => [
        clean(customerName, "Customer"),
        clean(orderNumber),
        clean(itemSummary, "OATCLUB order"),
        cleanAmount(amount),
      ],
  },

  OTP: {
    key: "OTP",
    messageId: null,
    templateId: null,
    templateName: null,
    language: "en",
    status: "NOT_CONFIGURED",
  },
});

export const getFast2SmsTemplate = (
  templateKey,
) => {
  const key = String(templateKey || "")
    .trim()
    .toUpperCase();

  const template = FAST2SMS_TEMPLATES[key];

  if (!template) {
    throw new Error(
      `Unknown Fast2SMS template: ${key}`,
    );
  }

  return template;
};

export const getApprovedFast2SmsTemplate = (
  templateKey,
) => {
  const template =
    getFast2SmsTemplate(templateKey);

  if (template.status !== "APPROVED") {
    throw new Error(
      `Fast2SMS template "${template.templateName || templateKey}" is not approved. Current status: ${template.status}`,
    );
  }

  if (!template.messageId) {
    throw new Error(
      `Fast2SMS message ID is missing for template: ${templateKey}`,
    );
  }

  return template;
};
