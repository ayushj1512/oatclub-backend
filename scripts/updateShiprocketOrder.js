import "dotenv/config";
import dns from "node:dns";
import mongoose from "mongoose";

import { shiprocketApi } from "../shiprocket/shiprocket.client.js";
import { buildShiprocketPayload } from "../shiprocket/shiprocket.payload.js";

dns.setServers(["1.1.1.1", "1.0.0.1"]);

const ORDER_NUMBER = "000615-A";
const NEW_AMOUNT = 1505.79; 

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const order = await mongoose.connection.db
    .collection("orders")
    .findOne({ orderNumber: ORDER_NUMBER });

  if (!order) {
    throw new Error(`Order ${ORDER_NUMBER} not found`);
  }

  const payload = buildShiprocketPayload(order);

  // Make product total equal to new COD amount
  const itemsTotal = payload.order_items.reduce(
    (sum, item) =>
      sum +
      Number(item.selling_price || 0) *
      Number(item.units || 1),
    0,
  );

  const difference = NEW_AMOUNT - itemsTotal;

  const paidItem = payload.order_items.find(
    (item) => Number(item.selling_price) > 0,
  );

  if (!paidItem) {
    throw new Error("No paid product found");
  }

  paidItem.selling_price = Number(
    (
      Number(paidItem.selling_price) +
      difference / Number(paidItem.units || 1)
    ).toFixed(2),
  );

  Object.assign(payload, {
    order_id: ORDER_NUMBER,
    order_date: new Date(order.orderDate || order.createdAt)
      .toISOString()
      .slice(0, 10),

    payment_method: "COD",
    sub_total: NEW_AMOUNT,

    channel_id: "",
    comment: `COD corrected to ₹${NEW_AMOUNT}`,

    shipping_charges: 0,
    giftwrap_charges: 0,
    transaction_charges: 0,
    total_discount: 0,
    is_document: "0",

    shipping_customer_name: "",
    shipping_last_name: "",
    shipping_address: "",
    shipping_address_2: "",
    shipping_city: "",
    shipping_pincode: "",
    shipping_country: "",
    shipping_state: "",
    shipping_email: "",
    shipping_phone: "",
  });

  console.log("📦 Updating:", {
    order: payload.order_id,
    phone: payload.billing_phone.replace(
      /^(\d{2})\d{6}(\d{2})$/,
      "$1******$2",
    ),
    amount: payload.sub_total,
    items: payload.order_items,
  });

  const result = await shiprocketApi({
    method: "POST",
    url: "/orders/update/adhoc",
    data: payload,
  });

  console.log("✅ Updated successfully:", result);
}

main()
  .catch((error) => {
    console.error(
      "❌ Failed:",
      error?.response?.data || error.message,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
