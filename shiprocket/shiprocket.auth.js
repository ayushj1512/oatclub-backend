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
  console.log("🧠 getShiprocketToken called:", { force });

  if (!force && token && Date.now() < expiresAt) {
    console.log("🟢 Using cached Shiprocket token");
    return token;
  }

  if (!force && pendingLogin) {
    console.log("🟡 Existing login already running, waiting...");
    return pendingLogin;
  }

  pendingLogin = (async () => {
    const email = str(process.env.SHIPROCKET_EMAIL);
    const password = str(process.env.SHIPROCKET_PASSWORD);
    const loginUrl = `${SHIPROCKET_BASE_URL}/auth/login`;

    console.log("🔍 Shiprocket Auth Debug:", {
      baseUrl: SHIPROCKET_BASE_URL,
      loginUrl,
      email,
      emailLength: email.length,
      passwordLength: password.length,
      passwordPreview: `${password.slice(0, 4)}...${password.slice(-4)}`,
      hasHash: password.includes("#"),
      hasPercent: password.includes("%"),
      hasAt: password.includes("@"),
      startsWithQuote: password.startsWith('"'),
      endsWithQuote: password.endsWith('"'),
    });

    if (!email || !password) {
      console.log("❌ Missing Shiprocket credentials");
      throw new Error("SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD not configured");
    }

    try {
      console.log("🚀 Calling Shiprocket login...");

      const { data, status } = await axios.post(
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

      console.log("✅ Shiprocket Login Success:", {
        status,
        responseEmail: data?.email,
        companyId: data?.company_id,
        hasToken: Boolean(data?.token || data?.data?.token || data?.token?.token),
      });

      const nextToken = data?.token || data?.data?.token || data?.token?.token;

      if (!nextToken) {
        console.log("❌ Token missing from response:", data);
        throw new Error("Shiprocket login did not return token");
      }

      token = nextToken;
      expiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000;

      console.log("💾 Shiprocket token cached:", {
        tokenLength: token.length,
        expiresAt: new Date(expiresAt).toISOString(),
      });

      return token;
    } catch (err) {
      console.log("❌ Shiprocket Login Failed:", {
        url: loginUrl,
        status: err?.response?.status,
        response: err?.response?.data,
        message: err?.message,
      });

      throw err;
    }
  })();

  try {
    return await pendingLogin;
  } finally {
    pendingLogin = null;
  }
}