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

  const res = await axios.get(
    `${SHIPROCKET_BASE_URL}/courier/serviceability/`,
    {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        pickup_postcode: pickupPincode,
        delivery_postcode: deliveryPincode,
        weight,
        cod: cod ? 1 : 0,
      },
    }
  );

  return res.data?.data?.available_courier_companies || [];
}
