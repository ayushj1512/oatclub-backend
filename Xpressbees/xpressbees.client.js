// // Xpressbees/xpressbees.client.js

// import { getXpressbeesToken } from "./xpressbees.auth.js";
// import { XPRESSBEES_DEFAULTS, XPRESSBEES_KEYS } from "./xpressbees.constants.js";

// function withSecretKey(body) {
//   if (!body || typeof body !== "object" || Array.isArray(body)) return body;

//   const secretKey = String(XPRESSBEES_KEYS?.secretKey || "").trim();
//   if (!secretKey) return body;

//   if (body.secretkey || body.secretKey) return body;

//   return { ...body, secretkey: secretKey };
// }

// function xpressbeesNotConfiguredResponse() {
//   return {
//     success: false,
//     configured: false,
//     provider: "xpressbees",
//     message: "XpressBees is not configured. Missing credentials.",
//   };
// }

// export async function xbFetch(
//   url,
//   { method = "POST", body, headers = {}, forceToken = false } = {}
// ) {
//   const token = await getXpressbeesToken({ force: forceToken });

//   if (!token) {
//     console.warn("⚠️ XpressBees request skipped: missing token/config.");
//     return xpressbeesNotConfiguredResponse();
//   }

//   const finalBody = withSecretKey(body);

//   const res = await fetch(url, {
//     method,
//     headers: {
//       "Content-Type": "application/json",
//       Authorization: `Bearer ${token}`,
//       ...headers,
//     },
//     body: finalBody ? JSON.stringify(finalBody) : undefined,
//     signal: AbortSignal.timeout?.(XPRESSBEES_DEFAULTS.timeoutMs),
//   });

//   const data = await res.json().catch(() => ({}));

//   if (res.status === 401) {
//     const newToken = await getXpressbeesToken({ force: true });

//     if (!newToken) {
//       console.warn("⚠️ XpressBees retry skipped: missing refreshed token.");
//       return xpressbeesNotConfiguredResponse();
//     }

//     const retryBody = withSecretKey(body);

//     const retry = await fetch(url, {
//       method,
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${newToken}`,
//         ...headers,
//       },
//       body: retryBody ? JSON.stringify(retryBody) : undefined,
//       signal: AbortSignal.timeout?.(XPRESSBEES_DEFAULTS.timeoutMs),
//     });

//     const retryData = await retry.json().catch(() => ({}));

//     if (!retry.ok) {
//       throw new Error(
//         retryData?.message || `XB request failed (${retry.status})`
//       );
//     }

//     return retryData;
//   }

//   if (!res.ok) {
//     throw new Error(data?.message || `XB request failed (${res.status})`);
//   }

//   return data;
// }