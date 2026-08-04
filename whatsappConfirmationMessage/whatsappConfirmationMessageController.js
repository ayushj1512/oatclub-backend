import WhatsappConfirmationMessage from "./whatsappConfirmationMessage.js";
import { sendFast2SmsWhatsappTemplate } from "../fast2sms/index.js";
/* =========================================================
   HELPERS
========================================================= */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const nowIST = () => new Date(Date.now() + IST_OFFSET_MS);

const cleanPhone = (value = "") => String(value).replace(/\D/g, "");

const normalizeStatus = (value = "") => {
  const status = String(value).trim().toLowerCase();

  if (["pending", "queued", "sent", "delivered", "read", "replied", "failed"].includes(status)) {
    return status;
  }

  if (["success", "submitted", "processed"].includes(status)) return "sent";
  if (["reply", "response", "incoming"].includes(status)) return "replied";
  if (["error", "fail", "undelivered"].includes(status)) return "failed";

  return "";
};

const getFailureReason = (data = {}) =>
  data?.error?.message ||
  data?.message ||
  data?.error ||
  "Failed to send whatsapp message";

const pickResponseIds = (payload = {}) => ({
  requestId:
    payload?.request_id ||
    payload?.requestId ||
    payload?.data?.request_id ||
    payload?.data?.requestId ||
    "",
  messageId:
    payload?.messages?.[0]?.id ||
    payload?.message_id ||
    payload?.messageId ||
    payload?.data?.messages?.[0]?.id ||
    payload?.data?.message_id ||
    payload?.data?.messageId ||
    "",
});

const pickWebhookIds = (payload = {}) => ({
  requestId:
    payload.fast2smsRequestId ||
    payload.requestId ||
    payload.request_id ||
    payload.data?.requestId ||
    payload.data?.request_id ||
    "",
  messageId:
    payload.fast2smsMessageId ||
    payload.messageId ||
    payload.message_id ||
    payload.msgId ||
    payload.msg_id ||
    payload.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.id ||
    payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id ||
    payload.data?.messageId ||
    payload.data?.message_id ||
    "",
});

const applyStatusTimestamps = (doc, status) => {
  const time = nowIST();

  if (status === "sent" && !doc.sentAt) doc.sentAt = time;
  if (status === "delivered" && !doc.deliveredAt) doc.deliveredAt = time;
  if (status === "read" && !doc.readAt) doc.readAt = time;
  if (status === "replied" && !doc.repliedAt) doc.repliedAt = time;
  if (status === "failed" && !doc.failedAt) doc.failedAt = time;
};

const buildListQuery = (query) => {
  const mongoQuery = {};

  if (query.status) mongoQuery.status = normalizeStatus(query.status) || query.status;
  if (query.orderId) mongoQuery.orderId = query.orderId;
  if (query.customerId) mongoQuery.customerId = query.customerId;
  if (query.direction) mongoQuery.direction = query.direction;

  if (query.phone) {
    const phone = cleanPhone(query.phone);
    if (phone) mongoQuery.phone = { $regex: phone };
  }

  if (query.templateName) {
    mongoQuery.templateName = { $regex: query.templateName, $options: "i" };
  }

  if (query.fromDate || query.toDate) {
    mongoQuery.createdAt = {};
    if (query.fromDate) mongoQuery.createdAt.$gte = new Date(query.fromDate);
    if (query.toDate) mongoQuery.createdAt.$lte = new Date(query.toDate);
  }

  return mongoQuery;
};

/* =========================================================
   SEND MESSAGE
========================================================= */
export const sendWhatsappConfirmationMessage = async (req, res) => {
  try {
    const {
      orderId = null,
      customerId = null,
      customerName = "",
      phone,
      countryCode = "91",
      messageType = "template",
      templateName = process.env.FAST2SMS_ORDER_CONFIRM_TEMPLATE_NAME || "order_confirmation_action",
      templateLanguage = process.env.FAST2SMS_ORDER_CONFIRM_TEMPLATE_LANGUAGE || "en",

      // for current template:
      // headerVariables: [orderNumber]
      // bodyVariables: [customerName, orderNumber, actionLink]
      headerVariables = [],
      bodyVariables = [],

      // fallback if old payload sends variables only
      variables = [],

      messageBody = "",
      notes = "",
    } = req.body || {};

    const normalizedPhone = cleanPhone(phone);

    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: "Phone is required",
      });
    }

    const finalBodyVariables = bodyVariables.length ? bodyVariables : variables;
    const allVariables = [...headerVariables, ...finalBodyVariables].map(String);

    const doc = await WhatsappConfirmationMessage.create({
      orderId,
      customerId,
      customerName,
      phone: normalizedPhone,
      countryCode,
      messageType,
      templateName,
      templateLanguage,
      variables: allVariables,
      messageBody,
      direction: "outgoing",
      status: "pending",
      notes,
    });

    const sendResult = await sendWhatsappTemplateMessage({
      phone: normalizedPhone,
      templateName,
      language: templateLanguage,
      headerVariables,
      bodyVariables: finalBodyVariables,
    });

    doc.rawSendResponse = sendResult;

    const ids = pickResponseIds(sendResult?.data || {});
    if (ids.requestId) doc.fast2smsRequestId = ids.requestId;
    if (ids.messageId) doc.fast2smsMessageId = ids.messageId;

    if (sendResult?.success) {
      doc.status = "sent";
      doc.sentAt = nowIST();
    } else {
      doc.status = "failed";
      doc.failedAt = nowIST();
      doc.failureReason = getFailureReason(sendResult?.data || sendResult);
    }

    await doc.save();

    return res.status(201).json({
      success: sendResult?.success,
      message: sendResult?.success
        ? "Whatsapp confirmation message sent"
        : "Message saved, but sending failed",
      data: doc,
    });
  } catch (error) {
    console.error("sendWhatsappConfirmationMessage error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send whatsapp confirmation message",
      error: error.message,
    });
  }
};

/* =========================================================
   WEBHOOK
========================================================= */
export const receiveWhatsappConfirmationWebhook = async (req, res) => {
  try {
    const payload = req.body || {};
    const value = payload.entry?.[0]?.changes?.[0]?.value || {};
    const statusObj = value.statuses?.[0] || {};
    const messageObj = value.messages?.[0] || {};

    const { requestId, messageId } = pickWebhookIds(payload);

    const incomingStatus =
      normalizeStatus(
        statusObj.status ||
          payload.status ||
          payload.event ||
          payload.eventType ||
          payload.type ||
          payload.message_status
      ) || "";

    const incomingPhone = cleanPhone(
      messageObj.from ||
        statusObj.recipient_id ||
        payload.phone ||
        payload.mobile ||
        payload.to ||
        payload.from ||
        payload.customerPhone ||
        ""
    );

    const incomingReplyText =
      messageObj.text?.body ||
      payload.customerReplyText ||
      payload.replyText ||
      payload.reply ||
      payload.message ||
      payload.text ||
      payload.body ||
      "";

    let doc = null;

    if (messageId) {
      doc = await WhatsappConfirmationMessage.findOne({ fast2smsMessageId: messageId });
    }

    if (!doc && requestId) {
      doc = await WhatsappConfirmationMessage.findOne({ fast2smsRequestId: requestId });
    }

    if (!doc && incomingPhone) {
      doc = await WhatsappConfirmationMessage.findOne({ phone: incomingPhone }).sort({
        createdAt: -1,
      });
    }

    if (!doc) {
      await WhatsappConfirmationMessage.create({
        phone: incomingPhone || "unknown",
        direction: incomingReplyText ? "incoming" : "outgoing",
        status: incomingReplyText ? "replied" : incomingStatus || "pending",
        fast2smsRequestId: requestId,
        fast2smsMessageId: messageId,
        customerReplyText: incomingReplyText || "",
        repliedAt: incomingReplyText ? nowIST() : null,
        rawWebhookPayload: payload,
      });

      return res.status(200).json({
        success: true,
        message: "Webhook stored as new message",
      });
    }

    doc.rawWebhookPayload = payload;

    if (requestId && !doc.fast2smsRequestId) doc.fast2smsRequestId = requestId;
    if (messageId && !doc.fast2smsMessageId) doc.fast2smsMessageId = messageId;

    if (incomingReplyText) {
      doc.direction = "incoming";
      doc.status = "replied";
      doc.customerReplyText = incomingReplyText;
      if (!doc.repliedAt) doc.repliedAt = nowIST();
    } else if (incomingStatus) {
      doc.status = incomingStatus;
      applyStatusTimestamps(doc, incomingStatus);

      if (incomingStatus === "failed") {
        doc.failureReason =
          statusObj.errors?.[0]?.message ||
          payload.failureReason ||
          payload.reason ||
          payload.error ||
          doc.failureReason ||
          "";
      }
    }

    await doc.save();

    return res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
    });
  } catch (error) {
    console.error("receiveWhatsappConfirmationWebhook error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to process webhook",
      error: error.message,
    });
  }
};

/* =========================================================
   GET ALL
========================================================= */
export const getWhatsappConfirmationMessages = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 100);    const skip = (page - 1) * limit;

    const mongoQuery = buildListQuery(req.query);

    const [items, total] = await Promise.all([
      WhatsappConfirmationMessage.find(mongoQuery)
        .populate("orderId", "orderNumber customerName customerPhone finalPayable paymentMethod")
        .populate("customerId", "name phone email customerCode")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      WhatsappConfirmationMessage.countDocuments(mongoQuery),
    ]);

    return res.status(200).json({
      success: true,
      message: "Whatsapp confirmation messages fetched successfully",
      data: items,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("getWhatsappConfirmationMessages error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch whatsapp confirmation messages",
      error: error.message,
    });
  }
};

/* =========================================================
   GET BY ORDER
========================================================= */
export const getWhatsappConfirmationMessagesByOrder = async (req, res) => {
  try {
    const items = await WhatsappConfirmationMessage.find({
      orderId: req.params.orderId,
    })
      .populate("orderId", "orderNumber customerName customerPhone finalPayable paymentMethod")
      .populate("customerId", "name phone email customerCode")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Order whatsapp confirmation messages fetched successfully",
      data: items,
    });
  } catch (error) {
    console.error("getWhatsappConfirmationMessagesByOrder error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch order whatsapp messages",
      error: error.message,
    });
  }
};

/* =========================================================
   GET BY ID
========================================================= */
export const getWhatsappConfirmationMessageById = async (req, res) => {
  try {
    const item = await WhatsappConfirmationMessage.findById(req.params.id)
      .populate("orderId", "orderNumber customerName customerPhone finalPayable paymentMethod")
      .populate("customerId", "name phone email customerCode");

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Whatsapp confirmation message not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Whatsapp confirmation message fetched successfully",
      data: item,
    });
  } catch (error) {
    console.error("getWhatsappConfirmationMessageById error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch whatsapp confirmation message",
      error: error.message,
    });
  }
};

/* =========================================================
   UPDATE STATUS
========================================================= */
export const updateWhatsappConfirmationMessageStatus = async (req, res) => {
  try {
    const { status, failureReason = "", customerReplyText = "", notes } = req.body || {};
    const normalizedStatus = normalizeStatus(status);

    if (!normalizedStatus) {
      return res.status(400).json({
        success: false,
        message: "Valid status is required",
      });
    }

    const item = await WhatsappConfirmationMessage.findById(req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Whatsapp confirmation message not found",
      });
    }

    item.status = normalizedStatus;
    applyStatusTimestamps(item, normalizedStatus);

    if (failureReason) item.failureReason = failureReason;

    if (customerReplyText) {
      item.customerReplyText = customerReplyText;
      item.direction = "incoming";
      if (!item.repliedAt) item.repliedAt = nowIST();
    }

    if (typeof notes === "string") item.notes = notes;

    await item.save();

    return res.status(200).json({
      success: true,
      message: "Whatsapp confirmation message status updated successfully",
      data: item,
    });
  } catch (error) {
    console.error("updateWhatsappConfirmationMessageStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update whatsapp confirmation message status",
      error: error.message,
    });
  }
};

/* =========================================================
   DELETE
========================================================= */
export const deleteWhatsappConfirmationMessage = async (req, res) => {
  try {
    const item = await WhatsappConfirmationMessage.findByIdAndDelete(req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Whatsapp confirmation message not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Whatsapp confirmation message deleted successfully",
    });
  } catch (error) {
    console.error("deleteWhatsappConfirmationMessage error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete whatsapp confirmation message",
      error: error.message,
    });
  }
};
