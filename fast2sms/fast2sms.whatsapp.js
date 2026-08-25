import { FAST2SMS_CONFIG } from "./fast2sms.config.js";
import { fast2smsRequest } from "./fast2sms.service.js";

import {
  getApprovedFast2SmsTemplate,
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

/* =========================================================
   BASE TEMPLATE SENDER
========================================================= */

export const sendFast2SmsWhatsappTemplate =
  async ({
    phone,
    templateKey,
    variables = [],
    udf1 = "",
    udf2 = "",
    udf3 = "",
  }) => {
    const template =
      getApprovedFast2SmsTemplate(templateKey);

    const normalizedPhone =
      normalizeIndianPhone(phone);

    const result = await fast2smsRequest({
      method: "GET",
      endpoint:
        FAST2SMS_CONFIG.ENDPOINTS.SEND_SIMPLE,

      params: {
        message_id: template.messageId,

        phone_number_id:
          FAST2SMS_CONFIG.PHONE_NUMBER_ID,

        numbers: normalizedPhone,

        ...(variables.length
          ? {
            variables_values:
              joinTemplateVariables(
                variables,
              ),
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
        templateName:
          template.templateName,
        templateId: template.templateId,
        messageId: template.messageId,
        phone: normalizedPhone,
      },
    };
  };

/* =========================================================
   COD ORDER CONFIRMATION REQUEST
========================================================= */

export const sendCodOrderConfirmationWhatsapp =
  async ({ order }) => {
    const orderNumber =
      getOrderNumber(order);

    const template =
      getApprovedFast2SmsTemplate(
        "COD_ORDER_CONFIRMATION",
      );

    const variables =
      template.buildVariables({
        customerName:
          getOrderCustomerName(order),

        orderNumber,

        actionLink:
          buildOrderActionLink(orderNumber),
      });

    return sendFast2SmsWhatsappTemplate({
      phone: getOrderPhone(order),
      templateKey:
        "COD_ORDER_CONFIRMATION",
      variables,
      udf1: orderNumber,
      udf2: "cod_order_confirmation",
      udf3: String(order?._id || ""),
    });
  };

/* =========================================================
   PAYMENT PENDING / FAILED
========================================================= */

export const sendPaymentPendingWhatsapp =
  async ({
    order,
    paymentStatus,
  }) => {
    const orderNumber =
      getOrderNumber(order);

    const normalizedStatus = String(
      paymentStatus ||
      order?.paymentStatus ||
      "pending",
    )
      .trim()
      .toLowerCase();

    const statusLabel =
      normalizedStatus === "failed"
        ? "Failed"
        : "Pending";

    const template =
      getApprovedFast2SmsTemplate(
        "PAYMENT_PENDING",
      );

    const variables =
      template.buildVariables({
        customerName:
          getOrderCustomerName(order),

        orderNumber,

        paymentStatus: statusLabel,

        amount: getOrderTotal(order),
      });

    return sendFast2SmsWhatsappTemplate({
      phone: getOrderPhone(order),
      templateKey: "PAYMENT_PENDING",
      variables,
      udf1: orderNumber,
      udf2: `payment_${normalizedStatus}`,
      udf3: String(order?._id || ""),
    });
  };

/* =========================================================
   PAYMENT CONFIRMED
========================================================= */

export const sendPrepaidOrderConfirmationWhatsapp =
  async ({ order }) => {
    const orderNumber =
      getOrderNumber(order);

    const template =
      getApprovedFast2SmsTemplate(
        "PREPAID_ORDER_CONFIRMATION",
      );

    const variables =
      template.buildVariables({
        customerName:
          getOrderCustomerName(order),

        orderNumber,

        itemSummary:
          getOrderItemSummary(order),

        amount: getOrderTotal(order),
      });

    return sendFast2SmsWhatsappTemplate({
      phone: getOrderPhone(order),

      templateKey:
        "PREPAID_ORDER_CONFIRMATION",

      variables,
      udf1: orderNumber,
      udf2: "payment_confirmed",
      udf3: String(order?._id || ""),
    });
  };

/* =========================================================
   PAYMENT COMPLETED ALIAS
   Keeps old controller/import compatible
========================================================= */

export const sendPaymentCompletedWhatsapp =
  async ({
    phone,
    amount,
    orderNumber,
    customerName = "Customer",
    itemSummary = "OATCLUB order",
  }) => {
    const template =
      getApprovedFast2SmsTemplate(
        "PREPAID_ORDER_CONFIRMATION",
      );

    const variables =
      template.buildVariables({
        customerName,
        orderNumber,
        itemSummary,
        amount,
      });

    return sendFast2SmsWhatsappTemplate({
      phone,

      templateKey:
        "PREPAID_ORDER_CONFIRMATION",

      variables,
      udf1: orderNumber,
      udf2: "payment_confirmed_manual",
    });
  };

/* =========================================================
   AUTO SELECTOR
========================================================= */

export const sendOrderConfirmationWhatsapp =
  async ({ order }) => {
    const paymentMethod = String(
      order?.paymentMethod ||
      order?.payment?.method ||
      order?.paymentMode ||
      "",
    )
      .trim()
      .toLowerCase();

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


/* =========================================================
 CUSTOMER WALLET CREDIT
========================================================= */

export const sendCustomerCreditWhatsapp =
  async ({
    phone,
    customerName = "Customer",
    amount,
    creditId = "",
  }) => {
    const template =
      getApprovedFast2SmsTemplate(
        "CUSTOMER_CREDITS_UPDATE",
      );

    const variables =
      template.buildVariables({
        customerName,
        amount,
      });

    return sendFast2SmsWhatsappTemplate({
      phone,
      templateKey:
        "CUSTOMER_CREDITS_UPDATE",
      variables,

      udf1: creditId,
      udf2: "customer_wallet_credit",
    });
  };
