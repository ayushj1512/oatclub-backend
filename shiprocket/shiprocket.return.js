import { shiprocketApi } from "./shiprocket.client.js";

export async function createReturnOrder(payload) {
  try {
    console.log("↩️ Shiprocket Create Return Order:", {
      order_id: payload?.order_id,
      items: payload?.order_items?.length,
    });

    return await shiprocketApi({
      method: "POST",
      url: "/orders/create/return",
      data: payload,
    });
  } catch (err) {
    console.error("❌ Shiprocket Return Order Error:", {
      status: err?.response?.status,
      data: err?.response?.data,
    });

    throw err;
  }
}
