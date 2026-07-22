import mongoose from "mongoose";
import OtpLog from "./otp.model.js";

import {
  DEFAULT_OTP_SORT,
  OTP_CONFIG,
  OTP_PURPOSES,
  OTP_SORT_FIELDS,
  OTP_STATUSES,
} from "./otp.constants.js";

import {
  calculateRemainingSeconds,
  compareOtpHash,
  escapeRegex,
  generateOtp,
  generateOtpReference,
  getLogRetentionExpiry,
  getOtpExpiry,
  hashOtp,
  isExpired,
  maskEmail,
  sanitizeLimit,
  sanitizePage,
} from "./otp.utils.js";

import { sendOtpEmail } from "./otp.mail.js";

export class OtpServiceError extends Error {
  constructor(message, statusCode = 400, code = "OTP_ERROR") {
    super(message);
    this.name = "OtpServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const activeStatuses = ["pending", "sent"];

const expireOldOtpLogs = async ({
  identifier,
  purpose,
  channel,
}) => {
  await OtpLog.updateMany(
    {
      identifier,
      purpose,
      channel,
      status: { $in: activeStatuses },
      expiresAt: { $lte: new Date() },
    },
    {
      $set: {
        status: "expired",
      },
    }
  );
};

const invalidateActiveOtpLogs = async ({
  identifier,
  purpose,
  channel,
}) => {
  await OtpLog.updateMany(
    {
      identifier,
      purpose,
      channel,
      status: { $in: activeStatuses },
    },
    {
      $set: {
        status: "invalidated",
        invalidatedAt: new Date(),
      },
    }
  );
};

const getHourlySendCount = async ({
  identifier,
  purpose,
  channel,
}) => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  return OtpLog.countDocuments({
    identifier,
    purpose,
    channel,
    createdAt: { $gte: oneHourAgo },
    status: {
      $in: [
        "pending",
        "sent",
        "verified",
        "expired",
        "invalidated",
      ],
    },
  });
};

const getLastSentOtp = ({
  identifier,
  purpose,
  channel,
}) =>
  OtpLog.findOne({
    identifier,
    purpose,
    channel,
    status: {
      $in: ["pending", "sent"],
    },
  })
    .sort({ createdAt: -1 })
    .lean();

export const requestOtp = async ({
  identifier,
  channel,
  purpose,
  name,
  metadata,
  requestedIp,
  userAgent,
}) => {
  await expireOldOtpLogs({
    identifier,
    purpose,
    channel,
  });

  const lastOtp = await getLastSentOtp({
    identifier,
    purpose,
    channel,
  });

  if (lastOtp?.sentAt) {
    const nextAllowedAt = new Date(
      new Date(lastOtp.sentAt).getTime() +
        OTP_CONFIG.RESEND_COOLDOWN_SECONDS * 1000
    );

    const remainingSeconds =
      calculateRemainingSeconds(nextAllowedAt);

    if (remainingSeconds > 0) {
      throw new OtpServiceError(
        `Please wait ${remainingSeconds} seconds before requesting another OTP`,
        429,
        "OTP_COOLDOWN"
      );
    }
  }

  const hourlyCount = await getHourlySendCount({
    identifier,
    purpose,
    channel,
  });

  if (hourlyCount >= OTP_CONFIG.MAX_SENDS_PER_HOUR) {
    throw new OtpServiceError(
      "Maximum OTP request limit reached. Please try again after one hour",
      429,
      "OTP_HOURLY_LIMIT"
    );
  }

  await invalidateActiveOtpLogs({
    identifier,
    purpose,
    channel,
  });

  const otp = generateOtp();
  const referenceId = generateOtpReference();

  const otpLog = await OtpLog.create({
    referenceId,
    identifier,
    maskedIdentifier: maskEmail(identifier),
    channel,
    purpose,

    otpHash: hashOtp({
      otp,
      identifier,
      purpose,
      referenceId,
    }),

    status: "pending",
    attempts: 0,
    resendCount: hourlyCount,
    expiresAt: getOtpExpiry(),
    retentionExpiresAt: getLogRetentionExpiry(),

    requestedIp,
    userAgent,
    name,
    metadata,
  });

  try {
    const mailResult = await sendOtpEmail({
      to: identifier,
      otp,
      name,
      purpose,
    });

    otpLog.status = "sent";
    otpLog.sentAt = new Date();
    otpLog.providerMessageId =
      mailResult?.messageId ||
      mailResult?.id ||
      "";

    await otpLog.save();

    return {
      referenceId: otpLog.referenceId,
      identifier: otpLog.maskedIdentifier,
      purpose: otpLog.purpose,
      channel: otpLog.channel,
      expiresAt: otpLog.expiresAt,
      expiresInSeconds:
        OTP_CONFIG.EXPIRY_MINUTES * 60,
      resendAvailableInSeconds:
        OTP_CONFIG.RESEND_COOLDOWN_SECONDS,
    };
  } catch (error) {
    otpLog.status = "failed";
    otpLog.failedAt = new Date();
    otpLog.failureReason = String(
      error?.message || "OTP email delivery failed"
    ).slice(0, 1000);

    await otpLog.save();

    throw new OtpServiceError(
      "Unable to send OTP email. Please try again",
      500,
      "OTP_DELIVERY_FAILED"
    );
  }
};

export const verifyOtp = async ({
  identifier,
  channel,
  purpose,
  otp,
  referenceId,
}) => {
  await expireOldOtpLogs({
    identifier,
    purpose,
    channel,
  });

  const filter = {
    identifier,
    channel,
    purpose,
    status: "sent",
  };

  if (referenceId) {
    filter.referenceId = referenceId;
  }

  const otpLog = await OtpLog.findOne(filter)
    .sort({ createdAt: -1 })
    .select("+otpHash");

  if (!otpLog) {
    throw new OtpServiceError(
      "OTP not found, expired, or already used",
      400,
      "OTP_NOT_FOUND"
    );
  }

  if (isExpired(otpLog.expiresAt)) {
    otpLog.status = "expired";
    await otpLog.save();

    throw new OtpServiceError(
      "OTP has expired. Please request a new OTP",
      400,
      "OTP_EXPIRED"
    );
  }

  if (otpLog.attempts >= OTP_CONFIG.MAX_VERIFY_ATTEMPTS) {
    otpLog.status = "blocked";
    await otpLog.save();

    throw new OtpServiceError(
      "Maximum verification attempts reached. Please request a new OTP",
      429,
      "OTP_ATTEMPTS_EXCEEDED"
    );
  }

  otpLog.attempts += 1;
  otpLog.lastAttemptAt = new Date();

  const isValid = compareOtpHash({
    otp,
    identifier,
    purpose,
    referenceId: otpLog.referenceId,
    storedHash: otpLog.otpHash,
  });

  if (!isValid) {
    const attemptsRemaining = Math.max(
      0,
      OTP_CONFIG.MAX_VERIFY_ATTEMPTS -
        otpLog.attempts
    );

    if (attemptsRemaining === 0) {
      otpLog.status = "blocked";
    }

    await otpLog.save();

    throw new OtpServiceError(
      attemptsRemaining > 0
        ? `Invalid OTP. ${attemptsRemaining} attempt${
            attemptsRemaining === 1 ? "" : "s"
          } remaining`
        : "Maximum verification attempts reached. Please request a new OTP",
      attemptsRemaining > 0 ? 400 : 429,
      attemptsRemaining > 0
        ? "OTP_INVALID"
        : "OTP_ATTEMPTS_EXCEEDED"
    );
  }

  otpLog.status = "verified";
  otpLog.verifiedAt = new Date();

  await otpLog.save();

  await OtpLog.updateMany(
    {
      _id: { $ne: otpLog._id },
      identifier,
      channel,
      purpose,
      status: { $in: activeStatuses },
    },
    {
      $set: {
        status: "invalidated",
        invalidatedAt: new Date(),
      },
    }
  );

  return {
    verified: true,
    referenceId: otpLog.referenceId,
    identifier: otpLog.maskedIdentifier,
    purpose: otpLog.purpose,
    verifiedAt: otpLog.verifiedAt,
  };
};

const buildDateFilter = ({
  dateFrom,
  dateTo,
  createdFrom,
  createdTo,
}) => {
  const from = dateFrom || createdFrom;
  const to = dateTo || createdTo;

  if (!from && !to) return null;

  const dateFilter = {};

  if (from) {
    const startDate = new Date(from);

    if (!Number.isNaN(startDate.getTime())) {
      startDate.setHours(0, 0, 0, 0);
      dateFilter.$gte = startDate;
    }
  }

  if (to) {
    const endDate = new Date(to);

    if (!Number.isNaN(endDate.getTime())) {
      endDate.setHours(23, 59, 59, 999);
      dateFilter.$lte = endDate;
    }
  }

  return Object.keys(dateFilter).length
    ? dateFilter
    : null;
};

const buildLogFilter = (query = {}) => {
  const filter = {};

  if (query.identifier) {
    filter.identifier = {
      $regex: escapeRegex(query.identifier),
      $options: "i",
    };
  }

  if (query.referenceId) {
    filter.referenceId = {
      $regex: escapeRegex(query.referenceId),
      $options: "i",
    };
  }

  if (
    query.purpose &&
    OTP_PURPOSES.includes(query.purpose)
  ) {
    filter.purpose = query.purpose;
  }

  if (
    query.status &&
    OTP_STATUSES.includes(query.status)
  ) {
    filter.status = query.status;
  }

  if (query.channel) {
    filter.channel = query.channel;
  }

  if (query.ipAddress || query.requestedIp) {
    filter.requestedIp = {
      $regex: escapeRegex(
        query.ipAddress || query.requestedIp
      ),
      $options: "i",
    };
  }

  if (query.verified === "true") {
    filter.status = "verified";
  }

  if (query.verified === "false") {
    filter.status = { $ne: "verified" };
  }

  if (query.expired === "true") {
    filter.$or = [
      { status: "expired" },
      {
        expiresAt: { $lte: new Date() },
        status: { $in: activeStatuses },
      },
    ];
  }

  if (query.expired === "false") {
    filter.expiresAt = { $gt: new Date() };
  }

  const createdAt = buildDateFilter(query);

  if (createdAt) {
    filter.createdAt = createdAt;
  }

  if (query.q) {
    const expression = {
      $regex: escapeRegex(query.q),
      $options: "i",
    };

    filter.$or = [
      { identifier: expression },
      { maskedIdentifier: expression },
      { referenceId: expression },
      { requestedIp: expression },
      { purpose: expression },
      { status: expression },
    ];
  }

  return filter;
};

const getSort = (query = {}) => {
  if (query.sort) {
    const requestedFields = String(query.sort)
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);

    const safeFields = requestedFields.filter((field) => {
      const normalized = field.replace(/^-/, "");
      return OTP_SORT_FIELDS.includes(normalized);
    });

    if (safeFields.length) {
      return safeFields.join(" ");
    }
  }

  const sortBy = String(
    query.sortBy || ""
  ).replace(/^-/, "");

  if (OTP_SORT_FIELDS.includes(sortBy)) {
    const order =
      String(query.sortOrder).toLowerCase() === "asc"
        ? ""
        : "-";

    return `${order}${sortBy}`;
  }

  return DEFAULT_OTP_SORT;
};

export const getOtpLogs = async (query = {}) => {
  const page = sanitizePage(query.page);
  const limit = sanitizeLimit(query.limit);
  const skip = (page - 1) * limit;

  const filter = buildLogFilter(query);
  const sort = getSort(query);

  const [logs, total] = await Promise.all([
    OtpLog.find(filter)
      .select("-otpHash")
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),

    OtpLog.countDocuments(filter),
  ]);

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
    },
    filters: {
      identifier: query.identifier || null,
      purpose: query.purpose || null,
      status: query.status || null,
      channel: query.channel || null,
      dateFrom: query.dateFrom || null,
      dateTo: query.dateTo || null,
      q: query.q || null,
    },
    sorting: sort,
  };
};

export const getOtpLogById = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new OtpServiceError(
      "Invalid OTP log ID",
      400,
      "INVALID_LOG_ID"
    );
  }

  const log = await OtpLog.findById(id)
    .select("-otpHash")
    .lean();

  if (!log) {
    throw new OtpServiceError(
      "OTP log not found",
      404,
      "OTP_LOG_NOT_FOUND"
    );
  }

  return log;
};

export const deleteOtpLog = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new OtpServiceError(
      "Invalid OTP log ID",
      400,
      "INVALID_LOG_ID"
    );
  }

  const deleted = await OtpLog.findByIdAndDelete(id);

  if (!deleted) {
    throw new OtpServiceError(
      "OTP log not found",
      404,
      "OTP_LOG_NOT_FOUND"
    );
  }

  return {
    deleted: true,
    id,
  };
};

export const cleanupOtpLogs = async ({
  olderThanDays = OTP_CONFIG.LOG_RETENTION_DAYS,
  statuses = [],
} = {}) => {
  const parsedDays = Math.max(
    1,
    Number(olderThanDays) ||
      OTP_CONFIG.LOG_RETENTION_DAYS
  );

  const threshold = new Date(
    Date.now() -
      parsedDays * 24 * 60 * 60 * 1000
  );

  const filter = {
    createdAt: { $lte: threshold },
  };

  const safeStatuses = statuses.filter((status) =>
    OTP_STATUSES.includes(status)
  );

  if (safeStatuses.length) {
    filter.status = { $in: safeStatuses };
  }

  const result = await OtpLog.deleteMany(filter);

  return {
    deletedCount: result.deletedCount || 0,
    threshold,
  };
};

export const getOtpAnalytics = async (query = {}) => {
  const filter = buildLogFilter(query);

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [
    statusBreakdown,
    purposeBreakdown,
    channelBreakdown,
    total,
    today,
    averageVerification,
    topIdentifiers,
    dailyTrend,
  ] = await Promise.all([
    OtpLog.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),

    OtpLog.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$purpose",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),

    OtpLog.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$channel",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),

    OtpLog.countDocuments(filter),

    OtpLog.countDocuments({
      ...filter,
      createdAt: { $gte: todayStart },
    }),

    OtpLog.aggregate([
      {
        $match: {
          ...filter,
          status: "verified",
          sentAt: { $ne: null },
          verifiedAt: { $ne: null },
        },
      },
      {
        $project: {
          verificationTimeMs: {
            $subtract: [
              "$verifiedAt",
              "$sentAt",
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          averageMs: {
            $avg: "$verificationTimeMs",
          },
        },
      },
    ]),

    OtpLog.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$identifier",
          count: { $sum: 1 },
          verified: {
            $sum: {
              $cond: [
                { $eq: ["$status", "verified"] },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $project: {
          _id: 0,
          identifier: "$_id",
          count: 1,
          verified: 1,
        },
      },
    ]),

    OtpLog.aggregate([
      {
        $match: {
          ...filter,
          createdAt: {
            $gte: new Date(
              Date.now() -
                30 * 24 * 60 * 60 * 1000
            ),
          },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone: "Asia/Kolkata",
            },
          },
          total: { $sum: 1 },
          verified: {
            $sum: {
              $cond: [
                { $eq: ["$status", "verified"] },
                1,
                0,
              ],
            },
          },
          failed: {
            $sum: {
              $cond: [
                {
                  $in: [
                    "$status",
                    ["failed", "blocked"],
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const statusMap = Object.fromEntries(
    statusBreakdown.map((item) => [
      item._id,
      item.count,
    ])
  );

  const verified = statusMap.verified || 0;
  const failed =
    (statusMap.failed || 0) +
    (statusMap.blocked || 0);
  const expired = statusMap.expired || 0;
  const pending =
    (statusMap.pending || 0) +
    (statusMap.sent || 0);

  return {
    summary: {
      total,
      today,
      verified,
      failed,
      expired,
      pending,
      verificationRate:
        total > 0
          ? Number(
              ((verified / total) * 100).toFixed(2)
            )
          : 0,
      averageVerificationSeconds:
        averageVerification[0]?.averageMs
          ? Number(
              (
                averageVerification[0].averageMs /
                1000
              ).toFixed(2)
            )
          : 0,
    },

    statusBreakdown: statusBreakdown.map(
      (item) => ({
        status: item._id,
        count: item.count,
      })
    ),

    purposeBreakdown: purposeBreakdown.map(
      (item) => ({
        purpose: item._id,
        count: item.count,
      })
    ),

    channelBreakdown: channelBreakdown.map(
      (item) => ({
        channel: item._id,
        count: item.count,
      })
    ),

    topIdentifiers,
    dailyTrend: dailyTrend.map((item) => ({
      date: item._id,
      total: item.total,
      verified: item.verified,
      failed: item.failed,
    })),
  };
};