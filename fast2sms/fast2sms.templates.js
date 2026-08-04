export const FAST2SMS_TEMPLATES = Object.freeze({
  COD_ORDER_CONFIRMATION: {
    key: "COD_ORDER_CONFIRMATION",
    messageId: 26698,
    templateName: "order_confirmation_template",
    status: "APPROVED",

    buildVariables: ({
      customerName,
      orderNumber,
      actionLink,
    } = {}) => [
        String(orderNumber || "").trim(),
        String(customerName || "Customer").trim(),
        String(orderNumber || "").trim(),
        String(actionLink || "").trim(),
      ],
  },

  PAYMENT_COMPLETED: {
    key: "PAYMENT_COMPLETED",
    messageId: 26699,
    templateName: "payment_completed",
    status: "APPROVED",

    buildVariables: ({ amount } = {}) => [
      String(amount ?? "")
        .replace(/[₹,\s]/g, "")
        .trim(),
    ],
  },

  PREPAID_ORDER_CONFIRMATION: {
    key: "PREPAID_ORDER_CONFIRMATION",
    messageId: 27584,
    templateName: "order_paid_confirmation",
    status: "PENDING",

    buildVariables: ({
      customerName,
      orderNumber,
      itemSummary,
      amount,
    } = {}) => [
        String(customerName || "Customer").trim(),
        String(orderNumber || "").replace(/^#/, "").trim(),
        String(itemSummary || "").trim(),
        String(amount ?? "")
          .replace(/[₹,\s]/g, "")
          .trim(),
      ],
  },

  OTP: {
    key: "OTP",
    messageId: null,
    templateName: null,
    language: "en",
    status: "NOT_CONFIGURED",
  },
});

export const getFast2SmsTemplate = (templateKey) => {
  const template = FAST2SMS_TEMPLATES[templateKey];

  if (!template) {
    throw new Error(`Unknown Fast2SMS template: ${templateKey}`);
  }

  return template;
};

export const getApprovedFast2SmsTemplate = (templateKey) => {
  const template = getFast2SmsTemplate(templateKey);

  if (template.status !== "APPROVED") {
    throw new Error(
      `Fast2SMS template "${template.templateName || templateKey}" is not approved. Current status: ${template.status}`
    );
  }

  if (!template.messageId) {
    throw new Error(
      `Fast2SMS message ID is missing for template: ${templateKey}`
    );
  }

  return template;
};
