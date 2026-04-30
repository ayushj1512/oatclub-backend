import { FAST2SMS_CONFIG } from "./fast2sms.config.js";
import { assertFast2SMSReady } from "./fast2sms.utils.js";

export const fast2smsRequest = async ({
  method = "GET",
  url,
  data = {},
  params = {},
}) => {
  try {
    assertFast2SMSReady();

    const upperMethod = method.toUpperCase();
    let fullUrl = `${FAST2SMS_CONFIG.BASE_URL}${url}`;

    if (upperMethod === "GET") {
      const query = new URLSearchParams({
        ...params,
        authorization: FAST2SMS_CONFIG.API_KEY,
      }).toString();

      fullUrl += `?${query}`;
    }

    const res = await fetch(fullUrl, {
      method: upperMethod,
      headers: {
        authorization: FAST2SMS_CONFIG.API_KEY,
        "Content-Type": "application/json",
      },
      body: upperMethod === "POST" ? JSON.stringify(data) : undefined,
    });

    const json = await res.json().catch(() => ({}));

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