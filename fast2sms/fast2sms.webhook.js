export const parseFast2SMSWebhook = (payload = {}) => {
  return {
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
  };
};