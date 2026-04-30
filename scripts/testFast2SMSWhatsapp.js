// scripts/testFast2SMSWhatsapp.js

import "dotenv/config";
import {
  buildOrderActionLink,
  normalizeIndianPhone,
} from "../fast2sms/fast2sms.utils.js";
import { FAST2SMS_CONFIG } from "../fast2sms/fast2sms.config.js";

const order = {
  orderNumber: "MIRAY-004274",
  shippingAddressSnapshot: {
    fullName: "ayush",
    phone: "9811195362",
  },
};

const run = async () => {
  try {
    const phoneNumberId = FAST2SMS_CONFIG.PHONE_NUMBER_ID;
    const version = process.env.FAST2SMS_WHATSAPP_VERSION || "v24.0";
    const templateName =
      process.env.FAST2SMS_ORDER_CONFIRM_TEMPLATE_NAME ||
      "order_confirmation_action";
    const language =
      process.env.FAST2SMS_ORDER_CONFIRM_TEMPLATE_LANGUAGE || "en";

    if (!FAST2SMS_CONFIG.API_KEY) throw new Error("FAST2SMS_API_KEY missing");
    if (!phoneNumberId) throw new Error("FAST2SMS_PHONE_NUMBER_ID missing");

    const customerName = order.shippingAddressSnapshot.fullName || "Customer";
    const phone = normalizeIndianPhone(order.shippingAddressSnapshot.phone);
    const orderNumber = order.orderNumber;
    const actionLink = buildOrderActionLink(orderNumber);

    const url = `${FAST2SMS_CONFIG.BASE_URL}/whatsapp/${version}/${phoneNumberId}/messages`;

    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: `+91${phone}`,
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        components: [
          {
            type: "header",
            parameters: [{ type: "text", text: orderNumber }],
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: customerName },
              { type: "text", text: orderNumber },
              { type: "text", text: actionLink },
            ],
          },
        ],
      },
    };

    console.log("\n🚀 Sending WhatsApp Text Template\n");
    console.log("URL:", url);
    console.log("Body:", JSON.stringify(body, null, 2));

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: FAST2SMS_CONFIG.API_KEY,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));

    console.log("\n📡 Fast2SMS Response:");
    console.log(JSON.stringify({ success: res.ok && !json?.error, status: res.status, data: json }, null, 2));

    if (!res.ok || json?.error) {
      console.error("\n❌ Message Failed");
      return;
    }

    console.log("\n✅ Message Sent Successfully");
  } catch (err) {
    console.error("\n💥 Test failed:");
    console.error(err.message || err);
  }
};

run();