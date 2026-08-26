import { shiprocketApi } from "./shiprocket.client.js";

export async function createShipment(payload) {
  try {
    const paymentMethod = String(
      payload?.payment_method || ""
    )
      .trim()
      .toUpperCase();

    const collectableAmount = Number(
      payload?.collectable_amount || 0
    );

    if (
      paymentMethod === "COD" &&
      collectableAmount < 0
    ) {
      throw new Error(
        "Invalid Shiprocket COD collectable amount"
      );
    }

    console.log("📦 Shiprocket Create Shipment:", {
      order_id: payload?.order_id,
      pickup_location: payload?.pickup_location,
      payment_method: payload?.payment_method,
      sub_total: payload?.sub_total,
      collectable_amount: payload?.collectable_amount,
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
      message: err?.message,
    });

    throw err;
  }
}
