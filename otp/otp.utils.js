import crypto from "crypto";
import { OTP_CONFIG } from "./otp.constants.js";

const getOtpSecret = () =>
  process.env.OTP_HASH_SECRET ||
  process.env.JWT_SECRET ||
  "oatclub-development-otp-secret";

export const generateOtp = (length = OTP_CONFIG.LENGTH) => {
  const min = 10 ** (length - 1);
  const max = 10 ** length;

  return String(crypto.randomInt(min, max));
};

export const generateOtpReference = () =>
  `OTP-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

export const hashOtp = ({
  otp,
  identifier,
  purpose,
  referenceId,
}) => {
  const value = [
    String(otp),
    String(identifier).toLowerCase(),
    String(purpose).toLowerCase(),
    String(referenceId),
  ].join(":");

  return crypto
    .createHmac("sha256", getOtpSecret())
    .update(value)
    .digest("hex");
};

export const compareOtpHash = ({
  otp,
  identifier,
  purpose,
  referenceId,
  storedHash,
}) => {
  if (!otp || !storedHash) return false;

  const incomingHash = hashOtp({
    otp,
    identifier,
    purpose,
    referenceId,
  });

  const incomingBuffer = Buffer.from(incomingHash, "hex");
  const storedBuffer = Buffer.from(storedHash, "hex");

  if (incomingBuffer.length !== storedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(incomingBuffer, storedBuffer);
};

export const normalizeEmail = (email = "") =>
  String(email).trim().toLowerCase();

export const normalizeIdentifier = (identifier = "", channel = "email") => {
  if (channel === "email") {
    return normalizeEmail(identifier);
  }

  return String(identifier).trim();
};

export const isValidEmail = (email = "") =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));

export const maskEmail = (email = "") => {
  const normalized = normalizeEmail(email);
  const [username, domain] = normalized.split("@");

  if (!username || !domain) return normalized;

  const visible =
    username.length <= 2
      ? username.charAt(0)
      : `${username.slice(0, 2)}${"*".repeat(
          Math.min(username.length - 2, 6)
        )}`;

  return `${visible}@${domain}`;
};

export const getOtpExpiry = () =>
  new Date(Date.now() + OTP_CONFIG.EXPIRY_MINUTES * 60 * 1000);

export const getLogRetentionExpiry = () =>
  new Date(
    Date.now() +
      OTP_CONFIG.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );

export const isExpired = (date) =>
  !date || new Date(date).getTime() <= Date.now();

export const getRequestIp = (req) => {
  const forwardedFor = req?.headers?.["x-forwarded-for"];

  if (forwardedFor) {
    return String(forwardedFor).split(",")[0].trim();
  }

  return (
    req?.ip ||
    req?.socket?.remoteAddress ||
    req?.connection?.remoteAddress ||
    ""
  );
};

export const getUserAgent = (req) =>
  String(req?.headers?.["user-agent"] || "").slice(0, 1000);

export const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const calculateRemainingSeconds = (date) => {
  const difference = new Date(date).getTime() - Date.now();

  return Math.max(0, Math.ceil(difference / 1000));
};

export const sanitizePage = (page) => {
  const parsed = Number.parseInt(page, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

export const sanitizeLimit = (limit, maximum = 100) => {
  const parsed = Number.parseInt(limit, 10);

  if (!Number.isFinite(parsed) || parsed < 1) return 20;

  return Math.min(parsed, maximum);
};