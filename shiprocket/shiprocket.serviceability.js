import axios from "axios";
import { getShiprocketToken } from "./shiprocket.auth.js";
import { SHIPROCKET_BASE_URL } from "./shiprocket.config.js";

export async function checkServiceability({
  pickupPincode,
  deliveryPincode,
  weight,
  cod,
}) {
  const url = `${SHIPROCKET_BASE_URL}/courier/serviceability/`;

  const params = {
    pickup_postcode: String(pickupPincode || "").trim(),
    delivery_postcode: String(deliveryPincode || "").trim(),
    weight: Number(weight || 0.5),
    cod:
      cod === true || cod === "true" || cod === "1" || cod === 1 ? 1 : 0,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const isRetryable = (err) => {
    const status = err?.response?.status;
    const msg = String(err?.response?.data || err?.message || "").toLowerCase();

    return (
      status === 502 ||
      status === 503 ||
      status === 504 ||
      msg.includes("upstream") ||
      msg.includes("connection") ||
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout")
    );
  };

  const isAuthError = (err) => {
    const status = err?.response?.status;
    const msg = String(err?.response?.data || err?.message || "").toLowerCase();

    return (
      status === 401 ||
      status === 403 ||
      msg.includes("token") ||
      msg.includes("unauthorized")
    );
  };

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const token = await getShiprocketToken(); // 🔥 fresh each attempt

      console.log("🚚 Shiprocket Serviceability:", {
        url,
        params,
        attempt,
        tokenLength: token?.length || 0,
      });

      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params,
        timeout: 30000,
      });

      const data = res.data;

      return (
        data?.data?.available_courier_companies ||
        data?.available_courier_companies ||
        []
      );
    } catch (err) {
      lastError = err;

      console.error("❌ Shiprocket Serviceability Error:", {
        url,
        params,
        attempt,
        status: err?.response?.status,
        data: err?.response?.data || err.message,
      });

      // 🔥 AUTH FIX (token expired)
      if (isAuthError(err) && attempt < 3) {
        console.log("🔄 Token issue detected, retrying with fresh token...");
        continue;
      }

      // 🔥 RETRYABLE ERRORS
      if (isRetryable(err) && attempt < 3) {
        await sleep(attempt * 2000); // 2s → 4s → 6s
        continue;
      }

      break;
    }
  }

  throw lastError; // important for controller
}