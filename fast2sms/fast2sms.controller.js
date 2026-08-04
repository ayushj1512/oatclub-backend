import {
  sendCodOrderConfirmationWhatsapp,
  sendOrderConfirmationWhatsapp,
  sendPaymentCompletedWhatsapp,
  sendPrepaidOrderConfirmationWhatsapp,
} from "./fast2sms.whatsapp.js";

import {
  getFast2SmsTemplate,
  FAST2SMS_TEMPLATES,
} from "./fast2sms.templates.js";

import {
  normalizeIndianPhone,
  normalizeOrderNumber,
} from "./fast2sms.utils.js";

const sendSuccess = (
  res,
  {
    message,
    result,
    statusCode = 200,
  }
) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data: result?.data || null,
    meta: result?.meta || null,
  });
};

const sendFailure = (
  res,
  {
    message,
    result,
    statusCode = 502,
  }
) => {
  return res.status(statusCode).json({
    success: false,
    message,
    error:
      result?.error ||
      result?.data?.message ||
      result?.data?.error ||
      "Fast2SMS WhatsApp request failed",
    providerResponse: result?.data || null,
    meta: result?.meta || null,
  });
};

const ensureOrder = (req, res) => {
  const order = req.body?.order;

  if (!order || typeof order !== "object") {
    res.status(400).json({
      success: false,
      message: "A valid order object is required",
    });

    return null;
  }

  return order;
};

/**
 * Automatically selects COD or prepaid template
 * based on the order payment method.
 *
 * POST /api/fast2sms/whatsapp/order-confirmation
 */
export const sendOrderConfirmationController = async (
  req,
  res
) => {
  try {
    const order = ensureOrder(req, res);

    if (!order) {
      return;
    }

    const result = await sendOrderConfirmationWhatsapp({
      order,
    });

    if (!result?.success) {
      return sendFailure(res, {
        message:
          "Order confirmation WhatsApp message could not be sent",
        result,
      });
    }

    return sendSuccess(res, {
      message:
        "Order confirmation WhatsApp message sent successfully",
      result,
    });
  } catch (error) {
    console.error(
      "[Fast2SMS] Order confirmation controller error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to send order confirmation WhatsApp message",
      error: error.message,
    });
  }
};

/**
 * Sends COD confirmation specifically.
 *
 * POST /api/fast2sms/whatsapp/cod-confirmation
 */
export const sendCodOrderConfirmationController = async (
  req,
  res
) => {
  try {
    const order = ensureOrder(req, res);

    if (!order) {
      return;
    }

    const result =
      await sendCodOrderConfirmationWhatsapp({
        order,
      });

    if (!result?.success) {
      return sendFailure(res, {
        message:
          "COD confirmation WhatsApp message could not be sent",
        result,
      });
    }

    return sendSuccess(res, {
      message:
        "COD confirmation WhatsApp message sent successfully",
      result,
    });
  } catch (error) {
    console.error(
      "[Fast2SMS] COD confirmation controller error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to send COD confirmation WhatsApp message",
      error: error.message,
    });
  }
};

/**
 * Sends prepaid confirmation.
 * Currently falls back to payment_completed
 * until the detailed prepaid template is approved.
 *
 * POST /api/fast2sms/whatsapp/prepaid-confirmation
 */
export const sendPrepaidOrderConfirmationController =
  async (req, res) => {
    try {
      const order = ensureOrder(req, res);

      if (!order) {
        return;
      }

      const result =
        await sendPrepaidOrderConfirmationWhatsapp({
          order,
        });

      if (!result?.success) {
        return sendFailure(res, {
          message:
            "Prepaid confirmation WhatsApp message could not be sent",
          result,
        });
      }

      return sendSuccess(res, {
        message:
          "Prepaid confirmation WhatsApp message sent successfully",
        result,
      });
    } catch (error) {
      console.error(
        "[Fast2SMS] Prepaid confirmation controller error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to send prepaid confirmation WhatsApp message",
        error: error.message,
      });
    }
  };

/**
 * Manual payment completed message.
 *
 * POST /api/fast2sms/whatsapp/payment-completed
 *
 * Body:
 * {
 *   "phone": "9876543210",
 *   "amount": 899,
 *   "orderNumber": "000035"
 * }
 */
export const sendPaymentCompletedController = async (
  req,
  res
) => {
  try {
    const {
      phone,
      amount,
      orderNumber,
    } = req.body || {};

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    if (
      amount === undefined ||
      amount === null ||
      amount === ""
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment amount is required",
      });
    }

    const normalizedPhone =
      normalizeIndianPhone(phone);

    const normalizedOrderNumber =
      normalizeOrderNumber(orderNumber);

    const result =
      await sendPaymentCompletedWhatsapp({
        phone: normalizedPhone,
        amount,
        orderNumber: normalizedOrderNumber,
      });

    if (!result?.success) {
      return sendFailure(res, {
        message:
          "Payment completed WhatsApp message could not be sent",
        result,
      });
    }

    return sendSuccess(res, {
      message:
        "Payment completed WhatsApp message sent successfully",
      result,
    });
  } catch (error) {
    console.error(
      "[Fast2SMS] Payment completed controller error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to send payment completed WhatsApp message",
      error: error.message,
    });
  }
};

/**
 * Returns configured template metadata.
 * Does not expose API keys.
 *
 * GET /api/fast2sms/templates
 */
export const getFast2SmsTemplatesController = async (
  req,
  res
) => {
  try {
    const templates = Object.values(
      FAST2SMS_TEMPLATES
    ).map((template) => ({
      key: template.key,
      messageId: template.messageId,
      templateName: template.templateName,
      status: template.status,
      language: template.language || "en",
    }));

    return res.status(200).json({
      success: true,
      count: templates.length,
      data: templates,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        "Unable to fetch Fast2SMS templates",
      error: error.message,
    });
  }
};

/**
 * Returns one template.
 *
 * GET /api/fast2sms/templates/:templateKey
 */
export const getFast2SmsTemplateController = async (
  req,
  res
) => {
  try {
    const templateKey = String(
      req.params?.templateKey || ""
    )
      .trim()
      .toUpperCase();

    const template =
      getFast2SmsTemplate(templateKey);

    return res.status(200).json({
      success: true,
      data: {
        key: template.key,
        messageId: template.messageId,
        templateName: template.templateName,
        status: template.status,
        language: template.language || "en",
      },
    });
  } catch (error) {
    return res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};
