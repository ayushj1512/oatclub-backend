import axios from "axios";
import { getShiprocketToken } from "./shiprocket.auth.js";
import { SHIPROCKET_BASE_URL } from "./shiprocket.config.js";

export async function createShipment(payload) {
  const token = await getShiprocketToken();

  const url = `${SHIPROCKET_BASE_URL}/orders/create/adhoc`;

  try {
    console.log("📦 Shiprocket Create Shipment:", {
      url,
      tokenLength: token?.length || 0,
      order_id: payload?.order_id,
      pickup_location: payload?.pickup_location,
      payment_method: payload?.payment_method,
    });

    const res = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}` },
    });

    return res.data;
  } catch (err) {
    console.error("❌ Shiprocket Create Shipment Error:", {
      url,
      status: err?.response?.status,
      data: err?.response?.data,
    });

    throw err;
  }
}
