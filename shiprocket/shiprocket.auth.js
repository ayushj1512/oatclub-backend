import axios from "axios";
import { SHIPROCKET_BASE_URL } from "./shiprocket.config.js";

let token = null;
let expiresAt = 0;
let pendingLogin = null;

const str = (v) => String(v ?? "").trim();

export function clearShiprocketToken() {
  token = null;
  expiresAt = 0;
}

export async function getShiprocketToken({ force = false } = {}) {
  if (!force && token && Date.now() < expiresAt) {
    return token;
  }

  if (!force && pendingLogin) {
    return pendingLogin;
  }

  pendingLogin = (async () => {
    const email = str(process.env.SHIPROCKET_EMAIL);
    const password = str(process.env.SHIPROCKET_PASSWORD);

    if (!email || !password) {
      throw new Error(
        "SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD not configured"
      );
    }

    const loginUrl = `${SHIPROCKET_BASE_URL}/auth/login`;

    try {
      const { data } = await axios.post(
        loginUrl,
        { email, password },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 30000,
        }
      );

      const nextToken =
        data?.token ||
        data?.data?.token ||
        data?.token?.token;

      if (!nextToken) {
        throw new Error("Shiprocket login did not return token");
      }

      token = nextToken;
      expiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000;

      return token;
    } catch (err) {
      throw err;
    }
  })();

  try {
    return await pendingLogin;
  } finally {
    pendingLogin = null;
  }
}