import axios from "axios";
import { SHIPROCKET_BASE_URL } from "./shiprocket.config.js";
import { clearShiprocketToken, getShiprocketToken } from "./shiprocket.auth.js";

const isAuthError = (err) => {
  const status = err?.response?.status;
  const msg = JSON.stringify(err?.response?.data || err?.message || "").toLowerCase();

  return (
    status === 401 ||
    status === 403 ||
    msg.includes("token") ||
    msg.includes("unauthorized") ||
    msg.includes("unauthenticated")
  );
};

export async function shiprocketApi({
  method = "GET",
  url,
  data,
  params,
  timeout = 30000,
  retry = true,
}) {
  try {
    const token = await getShiprocketToken();

    const res = await axios({
      method,
      url: `${SHIPROCKET_BASE_URL}${url}`,
      data,
      params,
      timeout,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    return res.data;
  } catch (err) {
    if (retry && isAuthError(err)) {
      clearShiprocketToken();

      return shiprocketApi({
        method,
        url,
        data,
        params,
        timeout,
        retry: false,
      });
    }

    throw err;
  }
}