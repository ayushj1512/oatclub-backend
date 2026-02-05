import axios from "axios";
import { SHIPROCKET_BASE_URL } from "./shiprocket.config.js";

let token = process.env.SHIPROCKET_TOKEN || null;
let expiresAt = 0;

const str = (v) => String(v ?? "").trim();

export async function getShiprocketToken({ force = false } = {}) {
  // ✅ If token already provided in env, use it directly (unless force)
  if (!force && process.env.SHIPROCKET_TOKEN) return process.env.SHIPROCKET_TOKEN;

  // ✅ Cached token
  if (!force && token && Date.now() < expiresAt) return token;

  // 🔁 fallback: login to generate new token
  const email = str(process.env.SHIPROCKET_EMAIL);
  const password = str(process.env.SHIPROCKET_PASSWORD);

  if (!email || !password) {
    throw new Error("SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD not configured");
  }

  const res = await axios.post(`${SHIPROCKET_BASE_URL}/auth/login`, { email, password });

  token = res?.data?.token || res?.data?.token?.token || res?.data?.data?.token || null;
  if (!token) throw new Error("Shiprocket login did not return token");

  // Shiprocket token validity varies; we cache 9 days (as you did)
  expiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000;

  return token;
}
