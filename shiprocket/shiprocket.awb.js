import { shiprocketApi } from "./shiprocket.client.js";

export async function assignAwb(shipmentId) {
  try {
    const data = await shiprocketApi({
      method: "POST",
      url: "/courier/assign/awb",
      data: {
        shipment_id: Number(shipmentId),
      },
    });

    return data;
  } catch (err) {
    console.error("❌ Shiprocket Assign AWB Error:", {
      shipmentId,
      status: err?.response?.status,
      data: err?.response?.data || err.message,
    });

    throw err;
  }
}