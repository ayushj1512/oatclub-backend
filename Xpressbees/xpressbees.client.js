// Xpressbees/xpressbees.client.js

import { getXpressbeesToken } from "./xpressbees.auth.js";
import { XPRESSBEES_DEFAULTS, XPRESSBEES_KEYS } from "./xpressbees.constants.js";

// Inject secretkey into request body (only when body is a plain object)
function withSecretKey(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;

  const secretKey = String(XPRESSBEES_KEYS?.secretKey || "").trim();
  if (!secretKey) return body; // don't break calls if config missing

  // don't override if already provided (supports both secretkey/secretKey)
  if (body.secretkey || body.secretKey) return body;

  return { ...body, secretkey: secretKey };
}

export async function xbFetch(
  url,
  { method = "POST", body, headers = {}, forceToken = false } = {}
) {
  const token = await getXpressbeesToken({ force: forceToken });

  const finalBody = withSecretKey(body);

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`, // common pattern
      ...headers,
    },
    body: finalBody ? JSON.stringify(finalBody) : undefined,
    signal: AbortSignal.timeout?.(XPRESSBEES_DEFAULTS.timeoutMs),
  });

  const data = await res.json().catch(() => ({}));

  // token expiry case
  if (res.status === 401) {
    const newToken = await getXpressbeesToken({ force: true });

    const retryBody = withSecretKey(body);

    const retry = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${newToken}`,
        ...headers,
      },
      body: retryBody ? JSON.stringify(retryBody) : undefined,
      signal: AbortSignal.timeout?.(XPRESSBEES_DEFAULTS.timeoutMs),
    });

    const retryData = await retry.json().catch(() => ({}));
    if (!retry.ok) {
      throw new Error(
        retryData?.message || `XB request failed (${retry.status})`
      );
    }
    return retryData;
  }

  if (!res.ok) {
    throw new Error(data?.message || `XB request failed (${res.status})`);
  }

  return data;
}
