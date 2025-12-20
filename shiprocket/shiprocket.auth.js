import axios from "axios";
import { SHIPROCKET_BASE_URL } from "./shiprocket.config.js";

let token = null;
let expiresAt = 0;

export async function getShiprocketToken() {
  if (token && Date.now() < expiresAt) return token;

  const res = await axios.post(
    `${SHIPROCKET_BASE_URL}/auth/login`,
    {
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD,
    }
  );

  token = res.data.token;
  expiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000; // ~9 days

  return token;
}
