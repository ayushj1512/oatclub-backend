export { default as otpRoutes } from "./otp.routes.js";
export { default as OtpLog } from "./otp.model.js";

export {
  requestOtp,
  verifyOtp,
  getOtpLogs,
  getOtpLogById,
  getOtpAnalytics,
  deleteOtpLog,
  cleanupOtpLogs,
} from "./otp.service.js";