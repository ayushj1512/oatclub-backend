import { FAST2SMS_CONFIG } from "./fast2sms.config.js";
import { fast2smsRequest } from "./fast2sms.service.js";

import {
  getApprovedFast2SmsTemplate,
  getFast2SmsTemplate,
} from "./fast2sms.templates.js";

import {
  buildOrderActionLink,
  getOrderCustomerName,
  getOrderItemSummary,
  getOrderNumber,
  getOrderPhone,
  getOrderTotal,
  joinTemplateVariables,
  normalizeIndianPhone,
} from "./fast2sms.utils.js";

export const sendFast2SmsWhatsappTemplate = async ({
  phone,
  templateKey,
  variables = [],
  udf1,
  udf2,
  udf3,
}) => {
  const template = getApprovedFast2SmsTemplate(templateKey);

  const normalizedPhone = normalizeIndianPhone(phone);

  const result = await fast2smsRequest({
    method: "GET",
    endpoint: FAST2SMS_CONFIG.ENDPOINTS.SEND_SIMPLE,

    params: {
      message_id: template.messageId,
      phone_number_id: FAST2SMS_CONFIG.PHONE_NUMBER_ID,
      numbers: normalizedPhone,

      ...(variables.length
        ? {
          variables_values:
            joinTemplateVariables(variables),
        }
        : {}),

      ...(udf1 ? { udf1 } : {}),
      ...(udf2 ? { udf2 } : {}),
      ...(udf3 ? { udf3 } : {}),
    },
  });

  return {
    ...result,

    meta: {
      templateKey,
      templateName: template.templateName,
      messageId: template.messageId,
      phone: normalizedPhone,
    },
  };
};

export const sendCodOrderConfirmationWhatsapp = async ({
  order,
}) => {
  const phone = getOrderPhone(order);
  const customerName = getOrderCustomerName(order);
  const orderNumber = getOrderNumber(order);
  const actionLink = buildOrderActionLink(orderNumber);

  const template = getApprovedFast2SmsTemplate(
    "COD_ORDER_CONFIRMATION"
  );

  const variables = template.buildVariables({
    customerName,
    orderNumber,
    actionLink,
  });

  return sendFast2SmsWhatsappTemplate({
    phone,
    templateKey: "COD_ORDER_CONFIRMATION",
    variables,
    udf1: orderNumber,
    udf2: "cod_order_confirmation",
  });
};

export const sendPaymentCompletedWhatsapp = async ({
  phone,
  amount,
  orderNumber,
}) => {
  const template = getApprovedFast2SmsTemplate(
    "PAYMENT_COMPLETED"
  );

  const variables = template.buildVariables({
    amount,
  });

  return sendFast2SmsWhatsappTemplate({
    phone,
    templateKey: "PAYMENT_COMPLETED",
    variables,
    udf1: orderNumber,
    udf2: "payment_completed",
  });
};

export const sendPrepaidOrderConfirmationWhatsapp = async ({
  order,
}) => {
  const template = getFast2SmsTemplate(
    "PREPAID_ORDER_CONFIRMATION"
  );

  if (template.status !== "APPROVED") {
    /*
     * Temporary fallback until detailed prepaid
     * order template gets approved.
     */
    return sendPaymentCompletedWhatsapp({
      phone: getOrderPhone(order),
      amount: getOrderTotal(order),
      orderNumber: getOrderNumber(order),
    });
  }

  const variables = template.buildVariables({
    customerName: getOrderCustomerName(order),
    orderNumber: getOrderNumber(order),
    itemSummary: getOrderItemSummary(order),
    amount: getOrderTotal(order),
  });

  return sendFast2SmsWhatsappTemplate({
    phone: getOrderPhone(order),
    templateKey: "PREPAID_ORDER_CONFIRMATION",
    variables,
    udf1: getOrderNumber(order),
    udf2: "prepaid_order_confirmation",
  });
};

export const sendOrderConfirmationWhatsapp = async ({
  order,
}) => {
  const paymentMethod = String(
    order?.paymentMethod ||
    order?.payment?.method ||
    order?.paymentMode ||
    ""
  ).toLowerCase();

  const isCod = [
    "cod",
    "cash_on_delivery",
    "cash on delivery",
  ].includes(paymentMethod);

  if (isCod) {
    return sendCodOrderConfirmationWhatsapp({
      order,
    });
  }

  return sendPrepaidOrderConfirmationWhatsapp({
    order,
  });
};
