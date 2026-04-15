import { FAST2SMS_CONFIG } from "./fast2sms.config.js";

export const fast2smsRequest = async ({
  method = "GET",
  url,
  data = {},
  params = {},
}) => {
  try {
    let fullUrl = `${FAST2SMS_CONFIG.BASE_URL}${url}`;

    if (method === "GET") {
      const query = new URLSearchParams({
        ...params,
        authorization: FAST2SMS_CONFIG.API_KEY,
      }).toString();

      fullUrl += `?${query}`;
    }

    const res = await fetch(fullUrl, {
      method,
      headers: {
        authorization: FAST2SMS_CONFIG.API_KEY,
        "Content-Type": "application/json",
      },
      body: method === "POST" ? JSON.stringify(data) : undefined,
    });

    const json = await res.json();

    return {
      success: res.ok,
      status: res.status,
      data: json,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
};