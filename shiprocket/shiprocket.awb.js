import axios from "axios";
import { getShiprocketToken } from "./shiprocket.auth.js";
import { SHIPROCKET_BASE_URL } from "./shiprocket.config.js";

export async function assignAwb(shipmentId) {
  const token = await getShiprocketToken();

  const url = `${SHIPROCKET_BASE_URL}/courier/assign/awb`;

  const res = await axios.post(
    url,
    { shipment_id: Number(shipmentId) },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return res.data;
}
