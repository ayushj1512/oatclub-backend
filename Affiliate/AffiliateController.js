import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import Affiliate from "./Affiliate.js";
import Coupon from "../Coupon/Coupon.js";
import Order from "../Orders/Orders.js";

/* ================================================================
   HELPERS
================================================================ */

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const toBoolean = (value) => {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
};

const normalizeCode = (value = "") =>
  String(value).trim().toUpperCase();

const normalizeUsername = (value = "") =>
  String(value).trim().toLowerCase();

const createToken = (affiliate) =>
  jwt.sign(
    {
      id: affiliate._id,
      role: "affiliate",
      affiliateNumber: affiliate.affiliateNumber,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.AFFILIATE_JWT_EXPIRES_IN || "30d",
    }
  );

const buildPagination = (query = {}) => {
  const page = Math.max(1, toNumber(query.page, 1));
  const limit = Math.min(100, Math.max(1, toNumber(query.limit, 20)));

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

const buildSort = (
  sortBy = "createdAt",
  sortOrder = "desc",
  allowedFields = []
) => {
  const field = allowedFields.includes(sortBy) ? sortBy : "createdAt";
  const direction = String(sortOrder).toLowerCase() === "asc" ? 1 : -1;

  return {
    [field]: direction,
    _id: direction,
  };
};

const buildDateFilter = (from, to) => {
  if (!from && !to) return null;

  const range = {};

  if (from) {
    const fromDate = new Date(from);

    if (!Number.isNaN(fromDate.getTime())) {
      range.$gte = fromDate;
    }
  }

  if (to) {
    const toDate = new Date(to);

    if (!Number.isNaN(toDate.getTime())) {
      toDate.setHours(23, 59, 59, 999);
      range.$lte = toDate;
    }
  }

  return Object.keys(range).length ? range : null;
};

const calculateCommission = ({
  order,
  commission,
}) => {
  const isCancelled =
    order?.cancellation?.isCancelled ||
    order?.fulfillmentStatus === "cancelled" ||
    order?.shipment?.status === "cancelled";

  const isReturned = [
    "returned",
    "refunded",
    "rto",
  ].includes(order?.fulfillmentStatus);

  const isRefunded = [
    "refunded",
    "partially_refunded",
  ].includes(order?.paymentStatus);

  if (isCancelled || isReturned || isRefunded) {
    return {
      amount: 0,
      status: "rejected",
      reason: isCancelled
        ? "Order cancelled"
        : isReturned
          ? "Order returned"
          : "Order refunded",
    };
  }

  const baseAmount =
    commission?.calculationBase === "subtotal"
      ? toNumber(order?.subtotal)
      : toNumber(order?.finalPayable);

  const amount =
    commission?.type === "flat"
      ? toNumber(commission?.value)
      : (baseAmount * toNumber(commission?.value)) / 100;

  const trigger = commission?.approvalTrigger || "delivered";

  const triggerCompleted =
    trigger === "paid"
      ? order?.paymentStatus === "paid"
      : trigger === "shipped"
        ? [
            "shipped",
            "out_for_delivery",
            "delivered",
          ].includes(order?.fulfillmentStatus) ||
          [
            "shipped",
            "in_transit",
            "out_for_delivery",
            "delivered",
          ].includes(order?.shipment?.status)
        : order?.fulfillmentStatus === "delivered" ||
          order?.shipment?.status === "delivered";

  if (!triggerCompleted) {
    return {
      amount,
      status: "pending",
      reason: `Waiting for ${trigger}`,
    };
  }

  if (trigger !== "delivered") {
    return {
      amount,
      status: "approved",
      reason: `${trigger} condition completed`,
    };
  }

  const deliveredAt =
    order?.fulfillmentDates?.deliveredAt ||
    order?.shipment?.deliveredAt ||
    order?.trackingDetails?.deliveredAt;

  const holdDays = Math.max(0, toNumber(commission?.holdDays));

  if (!deliveredAt || holdDays === 0) {
    return {
      amount,
      status: "approved",
      reason: "Delivered",
    };
  }

  const payableAt = new Date(deliveredAt);
  payableAt.setDate(payableAt.getDate() + holdDays);

  const approved = payableAt <= new Date();

  return {
    amount,
    status: approved ? "approved" : "pending",
    reason: approved
      ? "Return window completed"
      : "Return window active",
    payableAt,
  };
};

const buildAffiliateOrderFilter = ({
  affiliate,
  query = {},
}) => {
  const code = normalizeCode(affiliate?.coupon?.code);

  const filter = {
    $or: [
      { "affiliate.affiliateId": affiliate._id },
      { "coupon.code": code },
    ],
  };

  if (query.q) {
    const regex = new RegExp(escapeRegex(query.q), "i");

    filter.$and = [
      {
        $or: [
          { orderNumber: regex },
          { "shippingAddressSnapshot.fullName": regex },
          { "shippingAddressSnapshot.phone": regex },
          { "shippingAddressSnapshot.email": regex },
          { "coupon.code": regex },
          { "items.productSnapshot.title": regex },
          { "items.productSnapshot.productCode": regex },
        ],
      },
    ];
  }

  if (query.paymentStatus) {
    filter.paymentStatus = query.paymentStatus;
  }

  if (query.paymentMethod) {
    filter.paymentMethod = query.paymentMethod;
  }

  if (query.fulfillmentStatus) {
    filter.fulfillmentStatus = query.fulfillmentStatus;
  }

  if (query.isConfirmed !== undefined) {
    const isConfirmed = toBoolean(query.isConfirmed);

    if (isConfirmed !== undefined) {
      filter.isConfirmed = isConfirmed;
    }
  }

  if (query.orderType) {
    filter.orderType = query.orderType;
  }

  const dateFilter = buildDateFilter(query.from, query.to);

  if (dateFilter) {
    filter.createdAt = dateFilter;
  }

  return filter;
};

const evaluateAffiliate = async (affiliate) => {
  const filter = buildAffiliateOrderFilter({
    affiliate,
    query: {},
  });

  const orders = await Order.find(filter)
    .select(
      [
        "orderNumber",
        "subtotal",
        "finalPayable",
        "paymentStatus",
        "fulfillmentStatus",
        "isConfirmed",
        "cancellation",
        "shipment.status",
        "shipment.deliveredAt",
        "trackingDetails.deliveredAt",
        "fulfillmentDates.deliveredAt",
        "createdAt",
      ].join(" ")
    )
    .lean();

  const stats = {
    totalOrders: orders.length,
    confirmedOrders: 0,
    deliveredOrders: 0,
    cancelledOrders: 0,
    returnedOrders: 0,
    totalRevenue: 0,
    pendingCommission: 0,
    approvedCommission: 0,
    paidCommission: toNumber(affiliate?.stats?.paidCommission),
    lastOrderAt: null,
    lastEvaluatedAt: new Date(),
  };

  for (const order of orders) {
    if (order.isConfirmed) {
      stats.confirmedOrders += 1;
    }

    const isDelivered =
      order.fulfillmentStatus === "delivered" ||
      order.shipment?.status === "delivered";

    const isCancelled =
      order.cancellation?.isCancelled ||
      order.fulfillmentStatus === "cancelled" ||
      order.shipment?.status === "cancelled";

    const isReturned = [
      "returned",
      "refunded",
      "rto",
    ].includes(order.fulfillmentStatus);

    if (isDelivered) stats.deliveredOrders += 1;
    if (isCancelled) stats.cancelledOrders += 1;
    if (isReturned) stats.returnedOrders += 1;

    if (!isCancelled && !isReturned) {
      stats.totalRevenue += toNumber(order.finalPayable);
    }

    const evaluation = calculateCommission({
      order,
      commission: affiliate.commission,
    });

    if (evaluation.status === "pending") {
      stats.pendingCommission += evaluation.amount;
    }

    if (evaluation.status === "approved") {
      stats.approvedCommission += evaluation.amount;
    }

    if (
      !stats.lastOrderAt ||
      new Date(order.createdAt) > new Date(stats.lastOrderAt)
    ) {
      stats.lastOrderAt = order.createdAt;
    }
  }

  const lifetimePayable =
    stats.approvedCommission + stats.paidCommission;

  const totalPaid = toNumber(
    affiliate?.payoutSummary?.totalPaid ||
      stats.paidCommission
  );

  const pendingPayout = Math.max(
    0,
    stats.approvedCommission - totalPaid
  );

  affiliate.stats = stats;

  affiliate.payoutSummary = {
    ...affiliate.payoutSummary?.toObject?.(),
    lifetimePayable,
    totalPaid,
    pendingPayout,
    lastPaidAt: affiliate.payoutSummary?.lastPaidAt || null,
    lastPaymentReference:
      affiliate.payoutSummary?.lastPaymentReference || "",
  };

  await affiliate.save();

  return {
    stats,
    payoutSummary: affiliate.payoutSummary,
  };
};

/* ================================================================
   AFFILIATE AUTH MIDDLEWARE
================================================================ */

export const protectAffiliate = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Affiliate authentication required",
      });
    }

    const token = authorization.split(" ")[1];

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    if (decoded.role !== "affiliate") {
      return res.status(403).json({
        success: false,
        message: "Invalid affiliate token",
      });
    }

    const affiliate = await Affiliate.findOne({
      _id: decoded.id,
      isDeleted: false,
    });

    if (!affiliate) {
      return res.status(401).json({
        success: false,
        message: "Affiliate account not found",
      });
    }

    if (
      !affiliate.isActive ||
      affiliate.status === "blocked"
    ) {
      return res.status(403).json({
        success: false,
        message: "Affiliate account is inactive",
      });
    }

    req.affiliate = affiliate;
    req.affiliateId = affiliate._id;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired affiliate token",
    });
  }
};

/* ================================================================
   CREATE AFFILIATE
================================================================ */

export const createAffiliate = async (req, res) => {
  let affiliate = null;
  let coupon = null;

  try {
    const {
      name,
      username,
      password,
      email = "",
      phone = "",
      state = "",
      platform = "instagram",
      socialLinks = {},
      coupon: couponInput = {},
      commission = {},
      payoutAccount = {},
      notes = "",
      status = "active",
    } = req.body;

    if (!name || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, username and password are required",
      });
    }

    const normalizedUsername = normalizeUsername(username);

    const existingAffiliate = await Affiliate.findOne({
      username: normalizedUsername,
    }).lean();

    if (existingAffiliate) {
      return res.status(409).json({
        success: false,
        message: "Affiliate username already exists",
      });
    }

    const couponCode = normalizeCode(
      couponInput.code ||
        normalizedUsername
          .replace(/[^a-z0-9]/gi, "")
          .slice(0, 12)
    );

    if (!couponCode) {
      return res.status(400).json({
        success: false,
        message: "A valid coupon code is required",
      });
    }

    const existingCoupon = await Coupon.findOne({
      code: couponCode,
    }).lean();

    if (existingCoupon) {
      return res.status(409).json({
        success: false,
        message: "Coupon code already exists",
      });
    }

    affiliate = await Affiliate.create({
      name,
      username: normalizedUsername,
      password,
      email,
      phone,
      state,
      platform,
      socialLinks,

      coupon: {
        code: couponCode,
        discountType:
          couponInput.discountType || "percentage",
        discountValue: toNumber(
          couponInput.discountValue,
          10
        ),
        minPurchase: toNumber(
          couponInput.minPurchase,
          0
        ),
        maxDiscount: toNumber(
          couponInput.maxDiscount,
          0
        ),
      },

      commission: {
        type: commission.type || "percentage",
        value: toNumber(commission.value, 10),
        calculationBase:
          commission.calculationBase ||
          "final_payable",
        approvalTrigger:
          commission.approvalTrigger ||
          "delivered",
        holdDays: toNumber(commission.holdDays, 7),
      },

      payoutAccount,
      notes,
      status,
      createdBy: req.user?._id || null,
    });

    const validTill = couponInput.validTill
      ? new Date(couponInput.validTill)
      : new Date(
          new Date().setFullYear(
            new Date().getFullYear() + 5
          )
        );

    coupon = await Coupon.create({
      code: couponCode,
      type: "influencer",
      visibility: "private",
      description:
        couponInput.description ||
        `Affiliate coupon for ${name}`,

      discountType:
        couponInput.discountType || "percentage",

      discountValue: toNumber(
        couponInput.discountValue,
        10
      ),

      minPurchase: toNumber(
        couponInput.minPurchase,
        0
      ),

      maxDiscount: toNumber(
        couponInput.maxDiscount,
        0
      ),

      validFrom: couponInput.validFrom
        ? new Date(couponInput.validFrom)
        : new Date(),

      validTill,

      usageLimit: toNumber(
        couponInput.usageLimit,
        0
      ),

      usageLimitPerCustomer: toNumber(
        couponInput.usageLimitPerCustomer,
        0
      ),

      influencerId: affiliate._id,
      issuedBy: req.user?._id || null,
      isActive: status === "active",
    });

    affiliate.coupon.couponId = coupon._id;
    await affiliate.save();

    return res.status(201).json({
      success: true,
      message: "Affiliate created successfully",
      affiliate: affiliate.toSafeObject(),
      coupon,
    });
  } catch (error) {
    if (coupon?._id) {
      await Coupon.findByIdAndDelete(coupon._id).catch(
        () => null
      );
    }

    if (affiliate?._id) {
      await Affiliate.findByIdAndDelete(
        affiliate._id
      ).catch(() => null);
    }

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ================================================================
   LOGIN
================================================================ */

export const loginAffiliate = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    const affiliate = await Affiliate.findOne({
      username: normalizeUsername(username),
      isDeleted: false,
    }).select("+password");

    if (
      !affiliate ||
      !(await affiliate.comparePassword(password))
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    if (
      !affiliate.isActive ||
      affiliate.status !== "active"
    ) {
      return res.status(403).json({
        success: false,
        message: "Affiliate account is not active",
      });
    }

    affiliate.lastLoginAt = new Date();
    await affiliate.save();

    return res.json({
      success: true,
      message: "Login successful",
      token: createToken(affiliate),
      affiliate: affiliate.toSafeObject(),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ================================================================
   PROFILE
================================================================ */

export const getAffiliateProfile = async (req, res) => {
  try {
    const affiliate = await Affiliate.findById(
      req.affiliateId
    ).populate(
      "coupon.couponId",
      "code discountType discountValue minPurchase maxDiscount validFrom validTill usedCount isActive"
    );

    return res.json({
      success: true,
      affiliate,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ================================================================
   GET ALL AFFILIATES
   Filters:
   q, status, platform, isActive, state, couponCode
   minRevenue, maxRevenue, minCommission, maxCommission
   from, to, page, limit, sortBy, sortOrder
================================================================ */

export const getAllAffiliates = async (req, res) => {
  try {
    const {
      q,
      status,
      platform,
      state,
      couponCode,
      minRevenue,
      maxRevenue,
      minCommission,
      maxCommission,
      from,
      to,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const filter = {
      isDeleted: false,
    };

    if (q) {
      const regex = new RegExp(escapeRegex(q), "i");

      filter.$or = [
        { affiliateNumber: regex },
        { name: regex },
        { username: regex },
        { email: regex },
        { phone: regex },
        { state: regex },
        { "coupon.code": regex },
      ];
    }

    if (status) filter.status = status;
    if (platform) filter.platform = platform;
    if (state) {
      filter.state = new RegExp(
        `^${escapeRegex(state)}$`,
        "i"
      );
    }

    if (couponCode) {
      filter["coupon.code"] = normalizeCode(couponCode);
    }

    const isActive = toBoolean(req.query.isActive);

    if (isActive !== undefined) {
      filter.isActive = isActive;
    }

    if (minRevenue || maxRevenue) {
      filter["stats.totalRevenue"] = {};

      if (minRevenue) {
        filter["stats.totalRevenue"].$gte =
          toNumber(minRevenue);
      }

      if (maxRevenue) {
        filter["stats.totalRevenue"].$lte =
          toNumber(maxRevenue);
      }
    }

    if (minCommission || maxCommission) {
      filter["stats.approvedCommission"] = {};

      if (minCommission) {
        filter["stats.approvedCommission"].$gte =
          toNumber(minCommission);
      }

      if (maxCommission) {
        filter["stats.approvedCommission"].$lte =
          toNumber(maxCommission);
      }
    }

    const dateFilter = buildDateFilter(from, to);

    if (dateFilter) {
      filter.createdAt = dateFilter;
    }

    const { page, limit, skip } =
      buildPagination(req.query);

    const sort = buildSort(
      sortBy,
      sortOrder,
      [
        "createdAt",
        "updatedAt",
        "name",
        "affiliateNumber",
        "status",
        "platform",
        "stats.totalOrders",
        "stats.totalRevenue",
        "stats.pendingCommission",
        "stats.approvedCommission",
        "payoutSummary.pendingPayout",
        "lastLoginAt",
      ]
    );

    const [affiliates, total] = await Promise.all([
      Affiliate.find(filter)
        .populate(
          "coupon.couponId",
          "code discountType discountValue validTill usedCount isActive"
        )
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),

      Affiliate.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: affiliates,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
      filters: req.query,
      sort,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ================================================================
   GET AFFILIATE BY ID
================================================================ */

export const getAffiliateById = async (req, res) => {
  try {
    const affiliate = await Affiliate.findOne({
      _id: req.params.id,
      isDeleted: false,
    }).populate(
      "coupon.couponId",
      "code discountType discountValue minPurchase maxDiscount validFrom validTill usedCount usageLimit isActive"
    );

    if (!affiliate) {
      return res.status(404).json({
        success: false,
        message: "Affiliate not found",
      });
    }

    return res.json({
      success: true,
      affiliate,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ================================================================
   UPDATE AFFILIATE
================================================================ */

export const updateAffiliate = async (req, res) => {
  try {
    const affiliate = await Affiliate.findOne({
      _id: req.params.id,
      isDeleted: false,
    });

    if (!affiliate) {
      return res.status(404).json({
        success: false,
        message: "Affiliate not found",
      });
    }

    const blockedFields = [
      "_id",
      "password",
      "affiliateNumber",
      "stats",
      "payoutSummary",
      "isDeleted",
    ];

    for (const [key, value] of Object.entries(req.body)) {
      if (!blockedFields.includes(key)) {
        affiliate.set(key, value);
      }
    }

    if (req.body.username) {
      affiliate.username = normalizeUsername(
        req.body.username
      );
    }

    if (req.body.coupon?.code) {
      const nextCode = normalizeCode(
        req.body.coupon.code
      );

      const duplicate = await Affiliate.exists({
        _id: { $ne: affiliate._id },
        "coupon.code": nextCode,
        isDeleted: false,
      });

      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "Coupon code already assigned",
        });
      }

      affiliate.coupon.code = nextCode;
    }

    await affiliate.save();

    if (affiliate.coupon?.couponId) {
      await Coupon.findByIdAndUpdate(
        affiliate.coupon.couponId,
        {
          $set: {
            code: affiliate.coupon.code,
            discountType:
              affiliate.coupon.discountType,
            discountValue:
              affiliate.coupon.discountValue,
            minPurchase:
              affiliate.coupon.minPurchase,
            maxDiscount:
              affiliate.coupon.maxDiscount,
            isActive:
              affiliate.isActive &&
              affiliate.status === "active",
          },
        },
        {
          runValidators: true,
        }
      );
    }

    return res.json({
      success: true,
      message: "Affiliate updated successfully",
      affiliate: affiliate.toSafeObject(),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ================================================================
   CHANGE PASSWORD
================================================================ */

export const changeAffiliatePassword = async (
  req,
  res
) => {
  try {
    const affiliateId =
      req.params.id || req.affiliateId;

    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "New password must contain at least 6 characters",
      });
    }

    const affiliate = await Affiliate.findById(
      affiliateId
    ).select("+password");

    if (!affiliate || affiliate.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Affiliate not found",
      });
    }

    const isSelfUpdate =
      String(req.affiliateId || "") ===
      String(affiliate._id);

    if (isSelfUpdate) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: "Current password is required",
        });
      }

      const validPassword =
        await affiliate.comparePassword(
          currentPassword
        );

      if (!validPassword) {
        return res.status(400).json({
          success: false,
          message: "Current password is incorrect",
        });
      }
    }

    affiliate.password = newPassword;
    await affiliate.save();

    return res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ================================================================
   UPDATE STATUS
================================================================ */

export const updateAffiliateStatus = async (
  req,
  res
) => {
  try {
    const { status, isActive } = req.body;

    const allowedStatuses = [
      "pending",
      "active",
      "paused",
      "blocked",
    ];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid affiliate status",
      });
    }

    const update = {};

    if (status) {
      update.status = status;
      update.isActive = status === "active";
    }

    if (isActive !== undefined) {
      update.isActive = Boolean(isActive);
    }

    const affiliate =
      await Affiliate.findOneAndUpdate(
        {
          _id: req.params.id,
          isDeleted: false,
        },
        {
          $set: update,
        },
        {
          new: true,
          runValidators: true,
        }
      );

    if (!affiliate) {
      return res.status(404).json({
        success: false,
        message: "Affiliate not found",
      });
    }

    if (affiliate.coupon?.couponId) {
      await Coupon.findByIdAndUpdate(
        affiliate.coupon.couponId,
        {
          $set: {
            isActive:
              affiliate.isActive &&
              affiliate.status === "active",
          },
        }
      );
    }

    return res.json({
      success: true,
      message: "Affiliate status updated",
      affiliate: affiliate.toSafeObject(),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ================================================================
   AFFILIATE ORDERS
   Filters:
   q, paymentStatus, paymentMethod, fulfillmentStatus
   isConfirmed, commissionStatus, from, to
   page, limit, sortBy, sortOrder
================================================================ */

export const getAffiliateOrders = async (
  req,
  res
) => {
  try {
    const affiliateId =
      req.params.id || req.affiliateId;

    const affiliate = await Affiliate.findOne({
      _id: affiliateId,
      isDeleted: false,
    }).lean();

    if (!affiliate) {
      return res.status(404).json({
        success: false,
        message: "Affiliate not found",
      });
    }

    const filter = buildAffiliateOrderFilter({
      affiliate,
      query: req.query,
    });

    const { page, limit, skip } =
      buildPagination(req.query);

    const sort = buildSort(
      req.query.sortBy,
      req.query.sortOrder,
      [
        "createdAt",
        "orderDate",
        "orderNumber",
        "subtotal",
        "finalPayable",
        "paymentStatus",
        "fulfillmentStatus",
      ]
    );

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .select(
          [
            "orderNumber",
            "orderDate",
            "customerId",
            "shippingAddressSnapshot",
            "items",
            "subtotal",
            "discount",
            "shippingFee",
            "tax",
            "totalAmount",
            "finalPayable",
            "coupon",
            "paymentMethod",
            "paymentStatus",
            "fulfillmentStatus",
            "fulfillmentDates",
            "shipment",
            "trackingDetails",
            "cancellation",
            "isConfirmed",
            "createdAt",
            "updatedAt",
          ].join(" ")
        )
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),

      Order.countDocuments(filter),
    ]);

    const commissionStatus =
      req.query.commissionStatus;

    let evaluatedOrders = orders.map((order) => {
      const commissionEvaluation =
        calculateCommission({
          order,
          commission: affiliate.commission,
        });

      return {
        ...order,
        affiliateEvaluation: {
          affiliateId: affiliate._id,
          affiliateNumber:
            affiliate.affiliateNumber,
          affiliateName: affiliate.name,
          couponCode: affiliate.coupon?.code,
          commissionType:
            affiliate.commission?.type,
          commissionValue:
            affiliate.commission?.value,
          ...commissionEvaluation,
        },
      };
    });

    if (commissionStatus) {
      evaluatedOrders = evaluatedOrders.filter(
        (order) =>
          order.affiliateEvaluation.status ===
          commissionStatus
      );
    }

    return res.json({
      success: true,
      affiliate: {
        _id: affiliate._id,
        affiliateNumber:
          affiliate.affiliateNumber,
        name: affiliate.name,
        coupon: affiliate.coupon,
        commission: affiliate.commission,
      },
      data: evaluatedOrders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
      filters: req.query,
      sort,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ================================================================
   AFFILIATE DASHBOARD
================================================================ */

export const getAffiliateDashboard = async (
  req,
  res
) => {
  try {
    const affiliateId =
      req.params.id || req.affiliateId;

    const affiliate = await Affiliate.findOne({
      _id: affiliateId,
      isDeleted: false,
    });

    if (!affiliate) {
      return res.status(404).json({
        success: false,
        message: "Affiliate not found",
      });
    }

    const evaluation =
      await evaluateAffiliate(affiliate);

    const dateFilter = buildDateFilter(
      req.query.from,
      req.query.to
    );

    const orderFilter =
      buildAffiliateOrderFilter({
        affiliate,
        query: req.query,
      });

    if (dateFilter) {
      orderFilter.createdAt = dateFilter;
    }

    const dailyPerformance = await Order.aggregate([
      {
        $match: orderFilter,
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
            },
          },

          orders: {
            $sum: 1,
          },

          confirmedOrders: {
            $sum: {
              $cond: ["$isConfirmed", 1, 0],
            },
          },

          revenue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    {
                      $ne: [
                        "$fulfillmentStatus",
                        "cancelled",
                      ],
                    },
                    {
                      $ne: [
                        "$fulfillmentStatus",
                        "returned",
                      ],
                    },
                    {
                      $ne: [
                        "$fulfillmentStatus",
                        "refunded",
                      ],
                    },
                  ],
                },
                "$finalPayable",
                0,
              ],
            },
          },
        },
      },
      {
        $sort: {
          _id: 1,
        },
      },
    ]);

    return res.json({
      success: true,
      affiliate: affiliate.toSafeObject(),
      stats: evaluation.stats,
      payoutSummary:
        evaluation.payoutSummary,
      dailyPerformance,
      filters: {
        from: req.query.from || null,
        to: req.query.to || null,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ================================================================
   RECORD PAYOUT
================================================================ */

export const recordAffiliatePayout = async (
  req,
  res
) => {
  try {
    const {
      amount,
      reference = "",
      paidAt = new Date(),
      note = "",
    } = req.body;

    const payoutAmount = toNumber(amount);

    if (payoutAmount <= 0) {
      return res.status(400).json({
        success: false,
        message:
          "Payout amount must be greater than zero",
      });
    }

    const affiliate = await Affiliate.findOne({
      _id: req.params.id,
      isDeleted: false,
    });

    if (!affiliate) {
      return res.status(404).json({
        success: false,
        message: "Affiliate not found",
      });
    }

    await evaluateAffiliate(affiliate);

    const availablePayout = toNumber(
      affiliate.payoutSummary?.pendingPayout
    );

    if (payoutAmount > availablePayout) {
      return res.status(400).json({
        success: false,
        message: `Maximum available payout is ₹${availablePayout}`,
      });
    }

    affiliate.payoutSummary.totalPaid =
      toNumber(
        affiliate.payoutSummary.totalPaid
      ) + payoutAmount;

    affiliate.payoutSummary.pendingPayout =
      Math.max(
        0,
        toNumber(
          affiliate.payoutSummary.pendingPayout
        ) - payoutAmount
      );

    affiliate.payoutSummary.lastPaidAt =
      new Date(paidAt);

    affiliate.payoutSummary.lastPaymentReference =
      reference;

    affiliate.stats.paidCommission =
      toNumber(affiliate.stats.paidCommission) +
      payoutAmount;

    if (note) {
      affiliate.notes = [
        affiliate.notes,
        `Payout ₹${payoutAmount}: ${note}`,
      ]
        .filter(Boolean)
        .join("\n");
    }

    await affiliate.save();

    return res.json({
      success: true,
      message: "Affiliate payout recorded",
      payout: {
        amount: payoutAmount,
        reference,
        paidAt:
          affiliate.payoutSummary.lastPaidAt,
      },
      affiliate: affiliate.toSafeObject(),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ================================================================
   DELETE AFFILIATE
================================================================ */

export const deleteAffiliate = async (req, res) => {
  try {
    const affiliate = await Affiliate.findOne({
      _id: req.params.id,
      isDeleted: false,
    });

    if (!affiliate) {
      return res.status(404).json({
        success: false,
        message: "Affiliate not found",
      });
    }

    affiliate.isDeleted = true;
    affiliate.isActive = false;
    affiliate.status = "blocked";

    await affiliate.save();

    if (affiliate.coupon?.couponId) {
      await Coupon.findByIdAndUpdate(
        affiliate.coupon.couponId,
        {
          $set: {
            isActive: false,
          },
        }
      );
    }

    return res.json({
      success: true,
      message: "Affiliate deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};