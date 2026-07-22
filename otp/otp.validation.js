import {
  OTP_CHANNELS,
  OTP_PURPOSES,
} from "./otp.constants.js";
import {
  isValidEmail,
  normalizeIdentifier,
} from "./otp.utils.js";

export class OtpValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "OtpValidationError";
    this.statusCode = statusCode;
  }
}

const validatePurpose = (purpose) => {
  const normalized = String(purpose || "").trim().toLowerCase();

  if (!OTP_PURPOSES.includes(normalized)) {
    throw new OtpValidationError(
      `Invalid purpose. Accepted values: ${OTP_PURPOSES.join(", ")}`
    );
  }

  return normalized;
};

const validateChannel = (channel = "email") => {
  const normalized = String(channel).trim().toLowerCase();

  if (!OTP_CHANNELS.includes(normalized)) {
    throw new OtpValidationError(
      `Invalid channel. Accepted values: ${OTP_CHANNELS.join(", ")}`
    );
  }

  return normalized;
};

const validateIdentifier = (identifier, channel) => {
  const normalized = normalizeIdentifier(identifier, channel);

  if (!normalized) {
    throw new OtpValidationError("Email is required");
  }

  if (channel === "email" && !isValidEmail(normalized)) {
    throw new OtpValidationError("Please enter a valid email address");
  }

  return normalized;
};

export const validateSendOtpInput = (body = {}) => {
  const channel = validateChannel(body.channel || "email");
  const purpose = validatePurpose(body.purpose);
  const identifier = validateIdentifier(body.identifier, channel);

  return {
    identifier,
    channel,
    purpose,
    name: String(body.name || "").trim().slice(0, 100),
    metadata:
      body.metadata &&
      typeof body.metadata === "object" &&
      !Array.isArray(body.metadata)
        ? body.metadata
        : {},
  };
};

export const validateVerifyOtpInput = (body = {}) => {
  const channel = validateChannel(body.channel || "email");
  const purpose = validatePurpose(body.purpose);
  const identifier = validateIdentifier(body.identifier, channel);
  const otp = String(body.otp || "").trim();

  if (!/^\d{6}$/.test(otp)) {
    throw new OtpValidationError("Please enter a valid 6-digit OTP");
  }

  return {
    identifier,
    channel,
    purpose,
    otp,
    referenceId: String(body.referenceId || "").trim(),
  };
};