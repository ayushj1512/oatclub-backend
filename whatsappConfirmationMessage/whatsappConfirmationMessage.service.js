import WhatsappConfirmationMessage from "./whatsappConfirmationMessage.js";
import { sendOrderConfirmationWhatsapp } from "../fast2sms/index.js";
import { buildOrderActionLink, normalizeIndianPhone } from "../fast2sms/fast2sms.utils.js";

const nowIST = () =>
  new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

const getFailureReason = (result = {}) =>
  result?.data?.error?.message ||
  result?.data?.message ||
  result?.error ||
  "Failed to send WhatsApp confirmation message";

const pickMessageId = (result = {}) =>
  result?.data?.messages?.[0]?.id || result?.data?.message_id || "";

export const sendCodOrderConfirmationWhatsapp = async (order) => {
  try {
    if (!order) return null;
    if (order.paymentMethod !== "cod") return null;
    if (order.isConfirmed) return null;

    const phone =
      order?.shippingAddressSnapshot?.phone ||
      order?.billingAddressSnapshot?.phone ||
      order?.customerId?.phone;

    const customerName =
      order?.shippingAddressSnapshot?.fullName ||
      order?.billingAddressSnapshot?.fullName ||
      order?.customerId?.name ||
      "Customer";

    const orderNumber = order?.orderNumber;
    if (!phone || !orderNumber) return null;

    const actionLink = buildOrderActionLink(orderNumber);

    const doc = await WhatsappConfirmationMessage.create({
      orderId: order._id,
      customerId: order.customerId?._id || order.customerId || null,
      customerName,
      phone: normalizeIndianPhone(phone),
      countryCode: "91",
      messageType: "template",
      templateName: process.env.FAST2SMS_ORDER_CONFIRM_TEMPLATE_NAME || "order_confirmation_action",
      templateLanguage: process.env.FAST2SMS_ORDER_CONFIRM_TEMPLATE_LANGUAGE || "en",
      variables: [orderNumber, customerName, orderNumber, actionLink],
      messageBody: `Hi ${customerName}, your Miray order ${orderNumber} has been placed successfully. Confirm or cancel here: ${actionLink}`,
      direction: "outgoing",
      status: "pending",
      notes: "Auto sent for COD unconfirmed order",
    });

    const result = await sendOrderConfirmationWhatsapp({ order });

    doc.rawSendResponse = result;

    const messageId = pickMessageId(result);
    if (messageId) doc.fast2smsMessageId = messageId;

    if (result?.success) {
      doc.status = "sent";
      doc.sentAt = nowIST();
    } else {
      doc.status = "failed";
      doc.failedAt = nowIST();
      doc.failureReason = getFailureReason(result);
    }

    await doc.save();
    return doc;
  } catch (err) {
    console.error("sendCodOrderConfirmationWhatsapp error:", err.message);
    return null;
  }
};