// export async function getXpressbeesToken({ force = false } = {}) {
//   if (!force && isTokenValid()) return cachedToken;

//   const username = String(XPRESSBEES_KEYS.username || "").trim();
//   const password = String(XPRESSBEES_KEYS.password || "").trim();
//   const secretkey = String(XPRESSBEES_KEYS.secretKey || "").trim();

//   // Skip XpressBees if not configured
//   if (!username || !password || !secretkey) {
//     console.warn(
//       "⚠️ XpressBees credentials not configured. Skipping XpressBees authentication."
//     );

//     return null;
//   }

//   try {
//     const res = await fetch(XPRESSBEES_NEW_AUTH.TOKEN_URL, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         username,
//         password,
//         secretkey,
//       }),
//       signal: AbortSignal.timeout?.(
//         XPRESSBEES_DEFAULTS.timeoutMs
//       ),
//     });

//     const data = await res.json().catch(() => ({}));

//     if (!res.ok) {
//       console.warn(
//         `⚠️ XpressBees auth failed (${res.status})`,
//         data
//       );
//       return null;
//     }

//     const token =
//       data?.token ||
//       data?.accessToken ||
//       data?.data?.token ||
//       data?.result?.token;

//     if (!token) {
//       console.warn(
//         "⚠️ Token missing in XpressBees response"
//       );
//       return null;
//     }

//     cachedToken = token;
//     cachedAtMs = Date.now();

//     return token;
//   } catch (error) {
//     console.warn(
//       "⚠️ XpressBees authentication skipped:",
//       error.message
//     );
//     return null;
//   }
// }