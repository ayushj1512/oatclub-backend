import axios from "axios";
import { getShiprocketToken } from "./shiprocket.auth.js";

export async function cancelShiprocketShipment(shipmentId) {
  const token = await getShiprocketToken();

  const res = await axios.post(
    `${process.env.SHIPROCKET_BASE_URL}/orders/cancel/shipment`,
    { shipment_id: shipmentId },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return res.data;
}
