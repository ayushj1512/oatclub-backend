import axios from "axios";
import { getShiprocketToken } from "./shiprocket.auth.js";
import { SHIPROCKET_BASE_URL } from "./shiprocket.config.js";

export async function createShipment(payload) {
  const token = await getShiprocketToken();

  const res = await axios.post(
    `${SHIPROCKET_BASE_URL}/orders/create/adhoc`,
    payload,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  return res.data;
}
