import { shiprocketApi } from "./shiprocket.client.js";

const s = (value) => (value == null ? "" : String(value)).trim();

export async function generateShiprocketLabel(shipmentId) {
  const normalizedShipmentId = s(shipmentId);

  if (!normalizedShipmentId) {
    throw new Error("Shiprocket shipmentId is required");
  }

  const data = await shiprocketApi({
    method: "POST",
    url: "/courier/generate/label",
    data: {
      shipment_id: [Number(normalizedShipmentId)],
    },
    timeout: 30000,
  });

  const labelUrl = s(
    data?.label_url ||
      data?.labelUrl ||
      data?.response?.label_url ||
      data?.data?.label_url,
  );

  return {
    labelUrl,
    raw: data,
  };
}