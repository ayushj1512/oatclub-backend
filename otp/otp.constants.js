export const OTP_CONFIG = Object.freeze({
  LENGTH: 6,
  EXPIRY_MINUTES: 10,
  RESEND_COOLDOWN_SECONDS: 60,
  MAX_VERIFY_ATTEMPTS: 5,
  MAX_SENDS_PER_HOUR: 5,
  LOG_RETENTION_DAYS: 90,
});

export const OTP_CHANNELS = Object.freeze(["email"]);

export const OTP_PURPOSES = Object.freeze([
  "login",
  "signup",
  "email_verification",
  "password_reset",
  "order_verification",
]);

export const OTP_STATUSES = Object.freeze([
  "pending",
  "sent",
  "verified",
  "expired",
  "failed",
  "blocked",
  "invalidated",
]);

export const OTP_SORT_FIELDS = Object.freeze([
  "createdAt",
  "updatedAt",
  "sentAt",
  "verifiedAt",
  "expiresAt",
  "attempts",
  "resendCount",
  "status",
  "purpose",
  "identifier",
]);

export const DEFAULT_OTP_SORT = "-createdAt";