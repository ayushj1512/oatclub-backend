// Xpressbees/xpressbees.auth.js

import {
  XPRESSBEES_KEYS,
  XPRESSBEES_NEW_AUTH,
  XPRESSBEES_DEFAULTS,
} from "./xpressbees.constants.js";

let cachedToken = null;
let cachedAtMs = 0;

function isTokenValid() {
  if (!cachedToken) return false;
  const ageSec = (Date.now() - cachedAtMs) / 1000;
  return ageSec < XPRESSBEES_DEFAULTS.tokenCacheTtlSec;
}

/**
 * ✅ JWT Token (new auth)
 * Used for endpoints that accept Bearer token (e.g., forward manifestation, tracking APIs, etc.)
 */
export async function getXpressbeesToken({ force = false } = {}) {
  if (!force && isTokenValid()) return cachedToken;

  const username = String(XPRESSBEES_KEYS.username || "").trim();
  const password = String(XPRESSBEES_KEYS.password || "").trim();

  // IMPORTANT: XpressBees token API expects `secretkey` (lowercase) in payload
  const secretkey = String(XPRESSBEES_KEYS.secretKey || "").trim();

  if (!username || !password || !secretkey) {
    throw new Error(
      "XpressBees keys missing for token generation (username/password/secretKey)"
    );
  }

  // Token endpoint allows ONLY these 3 fields
  const payload = {
    username,
    password,
    secretkey, // ✅ lowercase
  };

  const res = await fetch(XPRESSBEES_NEW_AUTH.TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout?.(XPRESSBEES_DEFAULTS.timeoutMs),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || `Token generation failed (${res.status})`);
  }

  // Your API returns { token, code: 200 }
  const token =
    data?.token ||
    data?.accessToken ||
    data?.data?.token ||
    data?.result?.token;

  if (!token) {
    throw new Error("Token not found in XpressBees auth response");
  }

  cachedToken = token;
  cachedAtMs = Date.now();
  return token;
}

/**
 * ✅ Legacy Access Key (required by AWBNumberSeriesGeneration)
 * AWB series response: "Invalid xbAccessKey" => means this key is mandatory for that endpoint.
 *
 * NOTE: This key should NEVER be sent to the token endpoint payload.
 */
export function getXpressbeesAccessKey() {
  const xbAccessKey = String(
    XPRESSBEES_KEYS.xbAccessKey || XPRESSBEES_KEYS.accessKey || ""
  ).trim();

  if (!xbAccessKey) {
    throw new Error(
      "XpressBees xbAccessKey missing. Add XPRESSBEES_KEYS.xbAccessKey (env: XPRESSBEES_ACCESSKEY)."
    );
  }

  return xbAccessKey;
}
