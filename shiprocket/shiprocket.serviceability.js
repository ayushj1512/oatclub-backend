import axios from "axios";
import { getShiprocketToken } from "./shiprocket.auth.js";
import { SHIPROCKET_BASE_URL } from "./shiprocket.config.js";

export async function checkServiceability({
  pickupPincode,
  deliveryPincode,
  weight,
  cod,
}) {
  const token = await getShiprocketToken();

  const url = `${SHIPROCKET_BASE_URL}/courier/serviceability/`;
  const params = {
    pickup_postcode: String(pickupPincode || "").trim(),
    delivery_postcode: String(deliveryPincode || "").trim(),
    weight: Number(weight || 0.5),
    cod: cod ? 1 : 0,
  };

  try {
    console.log("🚚 Shiprocket Serviceability:", {
      url,
      params,
      tokenLength: token?.length || 0,
    });

    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      params,
    });

    return res.data?.data?.available_courier_companies || [];
  } catch (err) {
    console.error("❌ Shiprocket Serviceability Error:", {
      url,
      params,
      status: err?.response?.status,
      data: err?.response?.data,
    });

    throw err; // important so booking flow knows serviceability failed
  }
}
