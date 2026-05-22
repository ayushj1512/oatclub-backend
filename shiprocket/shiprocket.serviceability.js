import { shiprocketApi } from "./shiprocket.client.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableError = (err) => {
  const status = err?.response?.status;
  const msg = JSON.stringify(
    err?.response?.data || err?.message || ""
  ).toLowerCase();

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

export async function checkServiceability({
  pickupPincode,
  deliveryPincode,
  weight,
  cod,
}) {
  const params = {
    pickup_postcode: String(pickupPincode || "").trim(),
    delivery_postcode: String(deliveryPincode || "").trim(),
    weight: Number(weight || 0.5),
    cod:
      cod === true ||
      cod === "true" ||
      cod === "1" ||
      cod === 1
        ? 1
        : 0,
  };

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const data = await shiprocketApi({
        method: "GET",
        url: "/courier/serviceability/",
        params,
        timeout: 30000,
      });

      return (
        data?.data?.available_courier_companies ||
        data?.available_courier_companies ||
        []
      );
    } catch (err) {
      lastError = err;

      if (isRetryableError(err) && attempt < 3) {
        await sleep(attempt * 2000);
        continue;
      }

      break;
    }
  }

  throw lastError;
}