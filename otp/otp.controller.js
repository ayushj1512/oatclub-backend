import jwt from "jsonwebtoken";

import Customer from "../Customer/Customer.js";

import {
  cleanupOtpLogs,
  deleteOtpLog,
  getOtpAnalytics,
  getOtpLogById,
  getOtpLogs,
  requestOtp,
  verifyOtp,
} from "./otp.service.js";

import {
  validateSendOtpInput,
  validateVerifyOtpInput,
} from "./otp.validation.js";

import {
  getRequestIp,
  getUserAgent,
} from "./otp.utils.js";

/* =========================================================
   HELPERS
========================================================= */

const normalizeEmail = (value = "") =>
  String(value || "").trim().toLowerCase();

const sendError = (res, error) => {
  const statusCode =
    Number(error?.statusCode) || 500;

  return res.status(statusCode).json({
    success: false,
    message:
      error?.message ||
      "Something went wrong while processing OTP",
    code: error?.code || "OTP_ERROR",
  });
};

const createControllerError = (
  message,
  statusCode = 400,
  code = "OTP_ERROR",
) => {
  const error = new Error(message);

  error.statusCode = statusCode;
  error.code = code;

  return error;
};

const generateCustomerToken = (customer) => {
  const secret =
    process.env.AUTH_JWT_SECRET ||
    process.env.JWT_SECRET;

  if (!secret) {
    throw createControllerError(
      "Authentication service is not configured",
      500,
      "JWT_SECRET_MISSING",
    );
  }

  return jwt.sign(
    {
      sub: String(customer._id),
      customerId:
        customer.customerId || "",
      email: customer.email || "",
      role: "customer",
      authProvider: "email_otp",
    },
    secret,
    {
      expiresIn:
        process.env.AUTH_JWT_EXPIRES_IN ||
        process.env.JWT_EXPIRES_IN ||
        "7d",
      issuer: "oatclub",
      audience: "oatclub-storefront",
    },
  );
};

const resolveOtpCustomerSession = async ({
  identifier,
  purpose,
}) => {
  if (
    purpose !== "login" &&
    purpose !== "signup"
  ) {
    return null;
  }

  const email = normalizeEmail(identifier);

  if (!email) {
    throw createControllerError(
      "Verified email is missing",
      400,
      "EMAIL_MISSING",
    );
  }

  let customer = await Customer.findOne({
    email,
  });

  if (purpose === "login" && !customer) {
    throw createControllerError(
      "Customer account not found",
      404,
      "CUSTOMER_NOT_FOUND",
    );
  }

  if (purpose === "signup" && !customer) {
    customer = await Customer.create({
      email,
      isActive: true,
      joinedAt: new Date(),
    });
  }

  if (!customer) {
    throw createControllerError(
      "Customer account not found",
      404,
      "CUSTOMER_NOT_FOUND",
    );
  }

  if (customer.isActive === false) {
    throw createControllerError(
      "This customer account is inactive",
      403,
      "CUSTOMER_INACTIVE",
    );
  }

  const token =
    generateCustomerToken(customer);

  return {
    token,
    customer,
  };
};

/* =========================================================
   SEND OTP
========================================================= */

export const sendOtpController = async (
  req,
  res,
) => {
  try {
    const input =
      validateSendOtpInput(req.body);

    const result = await requestOtp({
      ...input,
      requestedIp: getRequestIp(req),
      userAgent: getUserAgent(req),
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      data: result,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

/* =========================================================
   RESEND OTP
========================================================= */

export const resendOtpController = async (
  req,
  res,
) => {
  try {
    const input =
      validateSendOtpInput(req.body);

    const result = await requestOtp({
      ...input,
      requestedIp: getRequestIp(req),
      userAgent: getUserAgent(req),
    });

    return res.status(200).json({
      success: true,
      message: "OTP resent successfully",
      data: result,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

/* =========================================================
   VERIFY OTP + CREATE CUSTOMER SESSION
========================================================= */

export const verifyOtpController = async (
  req,
  res,
) => {
  try {
    const input =
      validateVerifyOtpInput(req.body);

    const verificationResult =
      await verifyOtp(input);

    /*
     * Use input.identifier because the service response may
     * contain a masked identifier for frontend safety.
     */
    const authSession =
      await resolveOtpCustomerSession({
        identifier: input.identifier,
        purpose: input.purpose,
      });

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
      data: {
        ...verificationResult,

        ...(authSession
          ? {
              token: authSession.token,
              customer:
                authSession.customer,
            }
          : {}),
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

/* =========================================================
   OTP LOGS
========================================================= */

export const getOtpLogsController = async (
  req,
  res,
) => {
  try {
    const result = await getOtpLogs(
      req.query,
    );

    return res.status(200).json({
      success: true,
      message:
        "OTP logs fetched successfully",
      data: result.logs,
      pagination: result.pagination,
      filters: result.filters,
      sorting: result.sorting,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getOtpLogController = async (
  req,
  res,
) => {
  try {
    const result = await getOtpLogById(
      req.params.id,
    );

    return res.status(200).json({
      success: true,
      message:
        "OTP log fetched successfully",
      data: result,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const deleteOtpLogController = async (
  req,
  res,
) => {
  try {
    const result = await deleteOtpLog(
      req.params.id,
    );

    return res.status(200).json({
      success: true,
      message:
        "OTP log deleted successfully",
      data: result,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

/* =========================================================
   OTP CLEANUP
========================================================= */

export const cleanupOtpLogsController =
  async (req, res) => {
    try {
      const statuses = Array.isArray(
        req.body?.statuses,
      )
        ? req.body.statuses
        : [];

      const result = await cleanupOtpLogs({
        olderThanDays:
          req.body?.olderThanDays,
        statuses,
      });

      return res.status(200).json({
        success: true,
        message:
          "OTP logs cleaned successfully",
        data: result,
      });
    } catch (error) {
      return sendError(res, error);
    }
  };

/* =========================================================
   OTP ANALYTICS
========================================================= */

export const getOtpAnalyticsController =
  async (req, res) => {
    try {
      const result =
        await getOtpAnalytics(req.query);

      return res.status(200).json({
        success: true,
        message:
          "OTP analytics fetched successfully",
        data: result,
      });
    } catch (error) {
      return sendError(res, error);
    }
  };