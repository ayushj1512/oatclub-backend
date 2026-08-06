import { fast2smsRequest } from "./fast2sms.service.js";
import { FAST2SMS_CONFIG } from "./fast2sms.config.js";

export const fetchWhatsappLogs = async ({ from, to }) => {
  return fast2smsRequest({
    method: "GET",
    endpoint: FAST2SMS_CONFIG.ENDPOINTS.LOGS,
    params: { from, to },
  });
};
