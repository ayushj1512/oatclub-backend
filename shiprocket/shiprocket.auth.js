import axios from "axios";
import { SHIPROCKET_BASE_URL } from "./shiprocket.config.js";

let token = process.env.SHIPROCKET_TOKEN || null;
let expiresAt = 0;

export async function getShiprocketToken() {
  // ✅ If token already provided in env, use it directly
  if (token && Date.now() < expiresAt) return token;
  if (process.env.SHIPROCKET_TOKEN) return process.env.SHIPROCKET_TOKEN;

  // 🔁 fallback: login to generate new token
  const res = await axios.post(`${SHIPROCKET_BASE_URL}/auth/login`, {
    email: String(process.env.SHIPROCKET_EMAIL || "").trim(),
    password: String(process.env.SHIPROCKET_PASSWORD || "").trim(),
  });

  token = res.data.token;
  expiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000;

  return token;
}
