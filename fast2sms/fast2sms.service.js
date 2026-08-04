import { FAST2SMS_CONFIG } from "./fast2sms.config.js";
import { assertFast2SMSReady } from "./fast2sms.utils.js";

const parseFast2SmsResponse = async (response) => {
  const rawText = await response.text();

  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return {
      message: rawText,
    };
  }
};

export const fast2smsRequest = async ({
  method = "GET",
  endpoint,
  params = {},
  data,
}) => {
  assertFast2SMSReady();

  const upperMethod = String(method).toUpperCase();

  const url = new URL(
    `${FAST2SMS_CONFIG.BASE_URL}${endpoint}`
  );

  Object.entries(params).forEach(([key, value]) => {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(key, String(value));
    }
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: upperMethod,
      headers: {
        Authorization: FAST2SMS_CONFIG.API_KEY,
        accept: "application/json",
        ...(upperMethod !== "GET"
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body:
        upperMethod !== "GET" && data
          ? JSON.stringify(data)
          : undefined,
      signal: controller.signal,
    });

    const responseData = await parseFast2SmsResponse(response);

    const apiSuccess =
      responseData?.return === true ||
      responseData?.success === true ||
      responseData?.status === true;

    return {
      success: response.ok && !responseData?.error && apiSuccess !== false,
      status: response.status,
      data: responseData,
    };
  } catch (error) {
    return {
      success: false,
      status: null,
      error:
        error?.name === "AbortError"
          ? "Fast2SMS request timed out"
          : error?.message || "Fast2SMS request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
};
