import WhatsappConfirmationMessage from "./whatsappConfirmationMessage.js";

/* =========================================================
   HELPERS
========================================================= */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const nowIST = () => new Date(Date.now() + IST_OFFSET_MS);

const cleanPhone = (value = "") => String(value).replace(/\D/g, "");

const normalizeStatus = (value = "") => {
  const status = String(value).trim().toLowerCase();

  if (!status) return "";
  if (["pending", "queued", "sent", "delivered", "read", "replied", "failed"].includes(status)) {
    return status;
  }

  if (["success", "submitted", "processed"].includes(status)) return "sent";
  if (["reply", "replied", "response", "incoming"].includes(status)) return "replied";
  if (["error", "fail", "failed", "undelivered"].includes(status)) return "failed";

  return "";
};

const applyStatusTimestamps = (doc, status) => {
  const time = nowIST();

  if (status === "sent" && !doc.sentAt) doc.sentAt = time;
  if (status === "delivered" && !doc.deliveredAt) doc.deliveredAt = time;
  if (status === "read" && !doc.readAt) doc.readAt = time;
  if (status === "replied" && !doc.repliedAt) doc.repliedAt = time;
  if (status === "failed" && !doc.failedAt) doc.failedAt = time;
};

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
    payload.data?.messageId ||
    payload.data?.message_id ||
    "",
});

const buildListQuery = (query) => {
  const mongoQuery = {};

  if (query.status) mongoQuery.status = normalizeStatus(query.status) || query.status;
  if (query.orderId) mongoQuery.orderId = query.orderId;
  if (query.customerId) mongoQuery.customerId = query.customerId;

  if (query.phone) {
    const phone = cleanPhone(query.phone);
    if (phone) mongoQuery.phone = { $regex: phone };
  }

  if (query.templateName) {
    mongoQuery.templateName = { $regex: query.templateName, $options: "i" };
  }

  if (query.direction) {
    mongoQuery.direction = query.direction;
  }

  if (query.fromDate || query.toDate) {
    mongoQuery.createdAt = {};
    if (query.fromDate) mongoQuery.createdAt.$gte = new Date(query.fromDate);
    if (query.toDate) mongoQuery.createdAt.$lte = new Date(query.toDate);
  }

  return mongoQuery;
};

const sendFast2SMSWhatsapp = async ({
  phone,
  templateName,
  variables = [],
  messageBody = "",
}) => {
  const apiKey = process.env.FAST2SMS_API_KEY || process.env.FAST2SMS_AUTHORIZATION || "";
  const endpoint =
    process.env.FAST2SMS_WHATSAPP_API_URL ||
    "https://www.fast2sms.com/dev/whatsapp";

  if (!apiKey) {
    return {
      skipped: true,
      success: false,
      message: "FAST2SMS api key missing",
      data: null,
    };
  }

  const payload = {
    phone,
    template_name: templateName,
    variables,
    message: messageBody,
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: apiKey,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  return {
    skipped: false,
    success: response.ok,
    statusCode: response.status,
    data,
  };
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
      templateName = "",
      templateLanguage = "en",
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

    const doc = await WhatsappConfirmationMessage.create({
      orderId,
      customerId,
      customerName,
      phone: normalizedPhone,
      countryCode,
      messageType,
      templateName,
      templateLanguage,
      variables: Array.isArray(variables) ? variables.map(String) : [],
      messageBody,
      direction: "outgoing",
      status: "pending",
      notes,
    });

    const sendResult = await sendFast2SMSWhatsapp({
      phone: `${countryCode}${normalizedPhone}`,
      templateName,
      variables,
      messageBody,
    });

    doc.rawSendResponse = sendResult?.data || sendResult;

    const responseIds = pickWebhookIds(sendResult?.data || {});
    if (responseIds.requestId) doc.fast2smsRequestId = responseIds.requestId;
    if (responseIds.messageId) doc.fast2smsMessageId = responseIds.messageId;

    if (sendResult?.success) {
      doc.status = "sent";
      doc.sentAt = nowIST();
    } else if (sendResult?.skipped) {
      doc.status = "pending";
    } else {
      doc.status = "failed";
      doc.failedAt = nowIST();
      doc.failureReason =
        sendResult?.data?.message ||
        sendResult?.data?.error ||
        "Failed to send whatsapp message";
    }

    await doc.save();

    return res.status(201).json({
      success: true,
      message: sendResult?.success
        ? "Whatsapp confirmation message sent"
        : sendResult?.skipped
        ? "Message saved, Fast2SMS skipped because config missing"
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
    const { requestId, messageId } = pickWebhookIds(payload);

    const incomingStatus =
      normalizeStatus(
        payload.status ||
          payload.event ||
          payload.eventType ||
          payload.type ||
          payload.message_status
      ) || "";

    const incomingPhone = cleanPhone(
      payload.phone || payload.mobile || payload.to || payload.from || payload.customerPhone || ""
    );

    const incomingReplyText =
      payload.customerReplyText ||
      payload.replyText ||
      payload.reply ||
      payload.message ||
      payload.text ||
      payload.body ||
      "";

    let doc = null;

    if (messageId) {
      doc = await WhatsappConfirmationMessage.findOne({
        fast2smsMessageId: messageId,
      });
    }

    if (!doc && requestId) {
      doc = await WhatsappConfirmationMessage.findOne({
        fast2smsRequestId: requestId,
      });
    }

    if (!doc && incomingPhone) {
      doc = await WhatsappConfirmationMessage.findOne({
        phone: incomingPhone,
      }).sort({ createdAt: -1 });
    }

    if (!doc) {
      doc = await WhatsappConfirmationMessage.create({
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
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const skip = (page - 1) * limit;

    const mongoQuery = buildListQuery(req.query);

    const [items, total] = await Promise.all([
      WhatsappConfirmationMessage.find(mongoQuery)
        .populate("orderId", "orderNumber customerName customerPhone")
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
    const { orderId } = req.params;

    const items = await WhatsappConfirmationMessage.find({ orderId })
      .populate("orderId", "orderNumber customerName customerPhone")
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
      .populate("orderId", "orderNumber customerName customerPhone")
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