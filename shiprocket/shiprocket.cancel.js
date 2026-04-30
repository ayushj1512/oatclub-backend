import { shiprocketApi } from "./shiprocket.client.js";

export async function cancelShiprocketShipment(shipmentId) {
  try {
    const data = await shiprocketApi({
      method: "POST",
      url: "/orders/cancel/shipment",
      data: {
        shipment_id: shipmentId,
      },
    });

    return data;
  } catch (err) {
    console.error("❌ Shiprocket Cancel Shipment Error:", {
      shipmentId,
      status: err?.response?.status,
      data: err?.response?.data || err.message,
    });

    throw err;
  }
}