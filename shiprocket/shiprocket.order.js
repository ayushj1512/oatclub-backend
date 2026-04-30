import { shiprocketApi } from "./shiprocket.client.js";

export async function createShipment(payload) {
  try {
    console.log("📦 Shiprocket Create Shipment:", {
      order_id: payload?.order_id,
      pickup_location: payload?.pickup_location,
      payment_method: payload?.payment_method,
    });

    const data = await shiprocketApi({
      method: "POST",
      url: "/orders/create/adhoc",
      data: payload,
    });

    return data;
  } catch (err) {
    console.error("❌ Shiprocket Create Shipment Error:", {
      status: err?.response?.status,
      data: err?.response?.data,
    });

    throw err;
  }
}