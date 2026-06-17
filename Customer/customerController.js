import Customer from "./Customer.js";
import Order from "../Orders/Orders.js"; // ✅ adjust path if your Order model path is different
import { Mailer } from "../nodemailer/mailer.js";
import Counter from "../models/Counter.js";

/* =========================================================
   HELPERS
========================================================= */

const normalizeIncomingCustomer = (body = {}) => {
  const firebaseUID = body.firebaseUID ? String(body.firebaseUID).trim() : null;
  const email = body.email ? String(body.email).trim().toLowerCase() : "";
  const phone = body.phone ? String(body.phone).trim() : "";
  const name = body.name ? String(body.name).trim() : "";
  const profileImage = body.profileImage ? String(body.profileImage).trim() : "";

  return {
    firebaseUID: firebaseUID || null,
    email,
    phone,
    name,
    profileImage,
    referredBy: body.referredBy || null,
    referralCode: body.referralCode || null,
  };
};

const buildSafeUpdate = ({
  email,
  phone,
  name,
  profileImage,
  payoutDetails,
}) => {
  const $set = {};

  if (email) $set.email = email;
  if (phone) $set.phone = phone;
  if (name) $set.name = name;
  if (profileImage) $set.profileImage = profileImage;

  const bank = payoutDetails?.bank || {};
  const upi = payoutDetails?.upi || {};

  if (bank.accountHolderName) {
    $set["payoutDetails.bank.accountHolderName"] =
      bank.accountHolderName.trim();
  }

  if (bank.accountNumber) {
    $set["payoutDetails.bank.accountNumber"] = bank.accountNumber.trim();
  }

  if (bank.ifscCode) {
    $set["payoutDetails.bank.ifscCode"] = bank.ifscCode.trim().toUpperCase();
  }

  if (upi.upiId) {
    $set["payoutDetails.upi.upiId"] = upi.upiId.trim().toLowerCase();
  }

  if (
    bank.accountHolderName ||
    bank.accountNumber ||
    bank.ifscCode ||
    upi.upiId
  ) {
    $set["payoutDetails.updatedAt"] = new Date();
  }

  $set.updatedAt = new Date();

  return $set;
};

const percentage = (part, total) => {
  const p = Number(part || 0);
  const t = Number(total || 0);
  if (!t) return 0;
  return Number(((p / t) * 100).toFixed(2));
};

const latestDateFromOrders = (orders = [], path) => {
  const dates = orders
    .map((o) => {
      const value = path.split(".").reduce((acc, key) => acc?.[key], o);
      return value ? new Date(value) : null;
    })
    .filter((d) => d && !Number.isNaN(d.getTime()))
    .sort((a, b) => b - a);

  return dates[0] || null;
};

const getOrderDate = (order) =>
  order?.orderDate || order?.createdAt || order?.updatedAt || null;

const getCustomerType = ({
  totalOrders,
  totalSpend,
  rtoRate,
  returnRate,
  cancellationRate,
  lastOrderAt,
}) => {
  const now = Date.now();
  const lastOrderTime = lastOrderAt ? new Date(lastOrderAt).getTime() : null;
  const inactiveDays = lastOrderTime
    ? (now - lastOrderTime) / (1000 * 60 * 60 * 24)
    : null;

  if (totalOrders > 0 && inactiveDays !== null && inactiveDays >= 180) {
    return "inactive";
  }

  if (rtoRate >= 40 || returnRate >= 40 || cancellationRate >= 50) {
    return "risky";
  }

  if (totalOrders >= 5 && totalSpend >= 10000) {
    return "vip";
  }

  if (totalOrders >= 2) {
    return "repeat";
  }

  return "new";
};

const toNumber = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const getPagination = (query = {}) => {
  const limit = Math.min(100, Math.max(1, toNumber(query.limit, 20)));
  const page = Math.max(1, toNumber(query.page, 1));

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

const dateRangeFilter = (from, to) => {
  const filter = {};

  if (from) filter.$gte = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    filter.$lte = end;
  }

  return Object.keys(filter).length ? filter : null;
};

const generateCustomerId = async () => {
  const counter = await Counter.findOneAndUpdate(
    { name: "customerId" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  return String(counter.seq).padStart(4, "0");
};

/**
 * ✅ Recalculate customer analytics from orders
 * Source of truth: Order collection
 */
export const recalculateCustomerAnalytics = async (customerId) => {
  const customer = await Customer.findById(customerId).select("_id").lean();

  if (!customer) {
    throw new Error("Customer not found");
  }

  const orders = await Order.find({ customerId })
    .select(
      [
        "finalPayable",
        "totalAmount",
        "orderDate",
        "createdAt",
        "paymentMethod",
        "paymentStatus",
        "fulfillmentStatus",
        "isConfirmed",
        "confirmedBy",
        "fulfillmentDates",
      ].join(" ")
    )
    .lean();

  const totalOrders = orders.length;

  const totalSpend = orders.reduce((sum, order) => {
    const value = Number(order?.finalPayable ?? order?.totalAmount ?? 0);
    return sum + value;
  }, 0);

  const values = orders
    .map((order) => Number(order?.finalPayable ?? order?.totalAmount ?? 0))
    .filter((v) => v > 0);

  const countByFulfillment = (status) =>
    orders.filter((o) => o.fulfillmentStatus === status).length;

  const countByPaymentMethod = (method) =>
    orders.filter((o) => o.paymentMethod === method).length;

  const countByPaymentStatus = (status) =>
    orders.filter((o) => o.paymentStatus === status).length;

  const processingOrders = countByFulfillment("processing");
  const packedOrders = countByFulfillment("packed");
  const pickedOrders = countByFulfillment("picked");
  const shippedOrders = countByFulfillment("shipped");
  const outForDeliveryOrders = countByFulfillment("out_for_delivery");
  const deliveredOrders = countByFulfillment("delivered");

  const cancelledOrders = countByFulfillment("cancelled");
  const returnRequestedOrders = countByFulfillment("return_requested");
  const exchangeRequestedOrders = countByFulfillment("exchange_requested");
  const returnedOrders = countByFulfillment("returned");
  const refundedOrdersByFulfillment = countByFulfillment("refunded");
  const exchangedOrders = countByFulfillment("exchanged");
  const rtoOrders = countByFulfillment("rto");
  const failedOrders = countByFulfillment("failed");

  const codOrders = countByPaymentMethod("cod");
  const prepaidOrders = countByPaymentMethod("razorpay");
  const exchangeOrders = countByPaymentMethod("exchange");

  const paymentPendingOrders = countByPaymentStatus("pending");
  const paidOrders = countByPaymentStatus("paid");
  const paymentFailedOrders = countByPaymentStatus("failed");
  const refundPendingOrders = countByPaymentStatus("refund_pending");
  const refundedOrders = countByPaymentStatus("refunded");

  const confirmedOrders = orders.filter((o) => o.isConfirmed === true).length;
  const unconfirmedOrders = totalOrders - confirmedOrders;

  const confirmedByCustomerOrders = orders.filter(
    (o) => o.confirmedBy === "customer"
  ).length;

  const confirmedByAdminOrders = orders.filter(
    (o) => o.confirmedBy === "admin"
  ).length;

  const confirmedByAutoOrders = orders.filter(
    (o) => o.confirmedBy === "auto"
  ).length;

  const sortedOrders = [...orders].sort((a, b) => {
    const da = getOrderDate(a) ? new Date(getOrderDate(a)).getTime() : 0;
    const db = getOrderDate(b) ? new Date(getOrderDate(b)).getTime() : 0;
    return da - db;
  });

  const firstOrderAt = sortedOrders[0] ? getOrderDate(sortedOrders[0]) : null;
  const lastOrderAt = sortedOrders[sortedOrders.length - 1]
    ? getOrderDate(sortedOrders[sortedOrders.length - 1])
    : null;

  const avgOrderValue = totalOrders ? Number((totalSpend / totalOrders).toFixed(2)) : 0;

  const deliveryRate = percentage(deliveredOrders, totalOrders);
  const cancellationRate = percentage(cancelledOrders, totalOrders);
  const returnRate = percentage(returnedOrders, totalOrders);
  const rtoRate = percentage(rtoOrders, totalOrders);
  const paymentSuccessRate = percentage(paidOrders, totalOrders);

  const riskScore = Math.min(
    100,
    Number((rtoRate * 0.45 + returnRate * 0.35 + cancellationRate * 0.2).toFixed(2))
  );

  const customerType = getCustomerType({
    totalOrders,
    totalSpend,
    rtoRate,
    returnRate,
    cancellationRate,
    lastOrderAt,
  });

  const analyticsUpdate = {
    totalOrders,
    totalSpend,
    avgOrderValue,

    highestOrderValue: values.length ? Math.max(...values) : 0,
    lowestOrderValue: values.length ? Math.min(...values) : 0,

    processingOrders,
    packedOrders,
    pickedOrders,
    shippedOrders,
    outForDeliveryOrders,
    deliveredOrders,

    cancelledOrders,
    returnRequestedOrders,
    exchangeRequestedOrders,
    returnedOrders,
    refundedOrdersByFulfillment,
    exchangedOrders,
    rtoOrders,
    failedOrders,

    codOrders,
    prepaidOrders,
    exchangeOrders,

    paymentPendingOrders,
    paidOrders,
    paymentFailedOrders,
    refundPendingOrders,
    refundedOrders,

    confirmedOrders,
    unconfirmedOrders,
    confirmedByCustomerOrders,
    confirmedByAdminOrders,
    confirmedByAutoOrders,

    firstOrderAt,
    lastOrderAt,

    lastDeliveredAt: latestDateFromOrders(
      orders,
      "fulfillmentDates.deliveredAt"
    ),
    lastCancelledAt: latestDateFromOrders(
      orders,
      "fulfillmentDates.cancelledAt"
    ),
    lastReturnedAt: latestDateFromOrders(
      orders,
      "fulfillmentDates.returnedAt"
    ),
    lastRtoAt: latestDateFromOrders(orders, "fulfillmentDates.rtoAt"),

    deliveryRate,
    cancellationRate,
    returnRate,
    rtoRate,
    paymentSuccessRate,

    customerType,
    riskScore,

    lastAnalyticsSyncAt: new Date(),
  };

  const updatedCustomer = await Customer.findByIdAndUpdate(
    customerId,
    {
      $set: Object.entries(analyticsUpdate).reduce((acc, [key, value]) => {
        acc[`analytics.${key}`] = value;
        return acc;
      }, {}),
    },
    { new: true, runValidators: true }
  );

  return updatedCustomer;
};

const sendOnboardingIfPossible = async (customer) => {
  try {
    if (process.env.MAIL_ENABLED !== "true") {
      console.log("📭 Onboarding skipped: MAIL_ENABLED not true");
      return;
    }

    if (!customer?.email) {
      console.log("📭 Onboarding skipped: customer.email missing");
      return;
    }

    await Mailer.sendUserOnboarding({
      to: customer.email,
      name: customer?.name || "Customer",
      ctaUrl: `${process.env.CLIENT_URL}/account`,
      brandName: "Oatclub",
      supportEmail: process.env.MAIL_REPLY_TO || "hey@oatclub.in",
    });

    console.log(`✅ Onboarding email sent to: ${customer.email}`);
  } catch (err) {
    console.error("❌ Onboarding Mail Error FULL:", err);
  }
};

/* =========================================================
   CREATE CUSTOMER
========================================================= */

export const createCustomer = async (req, res) => {
  try {
    const {
      firebaseUID = null,
      email = "",
      name = "",
      phone = "",
      profileImage = "",
      referralCode,
      referredBy,
      payoutDetails = {},
    } = req.body;

    const safeFirebaseUID = firebaseUID ? String(firebaseUID).trim() : null;
    const safeEmail = email ? String(email).trim().toLowerCase() : "";
    const safePhone = phone ? String(phone).trim() : "";
    const safeName = name ? String(name).trim() : "";
    const safeProfileImage = profileImage ? String(profileImage).trim() : "";

    const bank = payoutDetails?.bank || {};
    const upi = payoutDetails?.upi || {};

    const safeAccountHolderName = bank?.accountHolderName
      ? String(bank.accountHolderName).trim()
      : "";

    const safeAccountNumber = bank?.accountNumber
      ? String(bank.accountNumber).trim()
      : "";

    const safeIfscCode = bank?.ifscCode
      ? String(bank.ifscCode).trim().toUpperCase()
      : "";

    const safeUpiId = upi?.upiId ? String(upi.upiId).trim().toLowerCase() : "";

    const hasPayout =
      !!safeAccountHolderName ||
      !!safeAccountNumber ||
      !!safeIfscCode ||
      !!safeUpiId;

    const finalReferralCode =
      referralCode ||
      Math.random().toString(36).substring(2, 10).toUpperCase();

    if (!safeFirebaseUID && !safeEmail && !safePhone) {
      return res.status(400).json({
        message: "Email or phone is required for guest checkout",
      });
    }

    if (safeFirebaseUID && safeEmail) {
      const uidExists = await Customer.findOne({ firebaseUID: safeFirebaseUID })
        .select("_id")
        .lean();

      if (!uidExists) {
        await Customer.updateOne(
          {
            email: safeEmail,
            $or: [
              { firebaseUID: null },
              { firebaseUID: "" },
              { firebaseUID: { $exists: false } },
            ],
          },
          { $set: { firebaseUID: safeFirebaseUID, updatedAt: new Date() } }
        );
      }
    }

    const filter = safeFirebaseUID
      ? { firebaseUID: safeFirebaseUID }
      : {
          $or: [
            ...(safeEmail ? [{ email: safeEmail }] : []),
            ...(safePhone ? [{ phone: safePhone }] : []),
          ],
        };

    const before = await Customer.findOne(filter)
      .select("email customerId")
      .lean();

    const wasCreated = !before;
    const wasEmailMissingBefore = !before?.email;
    const isOAuth = !!safeFirebaseUID;

    const $set = { updatedAt: new Date() };

    if (isOAuth) {
      if (safeEmail) $set.email = safeEmail;
      if (safeName) $set.name = safeName;
      if (safePhone) $set.phone = safePhone;
      if (safeProfileImage) $set.profileImage = safeProfileImage;
    } else {
      if (safeName) $set.name = safeName;
      if (safeEmail) $set.email = safeEmail;
      if (safePhone) $set.phone = safePhone;
      if (safeProfileImage) $set.profileImage = safeProfileImage;
    }

    if (safeAccountHolderName) {
      $set["payoutDetails.bank.accountHolderName"] = safeAccountHolderName;
    }

    if (safeAccountNumber) {
      $set["payoutDetails.bank.accountNumber"] = safeAccountNumber;
    }

    if (safeIfscCode) {
      $set["payoutDetails.bank.ifscCode"] = safeIfscCode;
    }

    if (safeUpiId) {
      $set["payoutDetails.upi.upiId"] = safeUpiId;
    }

    if (hasPayout) {
      $set["payoutDetails.updatedAt"] = new Date();
    }

    let generatedCustomerId = null;

    if (wasCreated) {
      const counter = await Counter.findOneAndUpdate(
        { name: "customerId" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );

      generatedCustomerId = String(counter.seq).padStart(4, "0");
    }

    const $setOnInsert = {
      customerId: generatedCustomerId,
      firebaseUID: safeFirebaseUID || null,
      referralCode: finalReferralCode,
      referredBy: referredBy || null,
      cart: {
        activeCartId: null,
        activeCartType: "cart",
        cartCount: 0,
        abandonedCartCount: 0,
        lastCartActivityAt: null,
        lastAbandonedCartId: null,
      },
      joinedAt: new Date(),
      createdAt: new Date(),
      isActive: true,
    };

    let customer;

    try {
      customer = await Customer.findOneAndUpdate(
        filter,
        { $set, $setOnInsert },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
          runValidators: true,
        }
      );
    } catch (err) {
      if (err?.code === 11000) {
        const fallback = await Customer.findOne(filter);
        if (fallback) {
          return res.status(200).json({
            message: "Customer already exists",
            customer: fallback,
          });
        }
      }

      throw err;
    }

    if (!customer?._id) {
      return res.status(500).json({
        message: "Customer upsert failed",
        error: "Customer document not returned from DB",
      });
    }

    if (
      customer?.email &&
      (wasCreated || (wasEmailMissingBefore && !!customer.email))
    ) {
      sendOnboardingIfPossible(customer);
    }

    return res.status(wasCreated ? 201 : 200).json({
      message: wasCreated ? "Customer created" : "Customer updated",
      customer,
    });
  } catch (error) {
    console.error("Create Customer Error FULL:", error);

    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/* =========================================================
   GET CUSTOMER BY CUSTOMER ID
========================================================= */

export const getCustomerByCustomerId = async (req, res) => {
  try {
    const { customerId } = req.params;

    const customer = await Customer.findOne({ customerId }).lean();

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json(customer);
  } catch (err) {
    console.error("Get Customer By CustomerId Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

/* =========================================================
   GET CUSTOMER BY FIREBASE UID
========================================================= */

export const getCustomerByFirebaseUID = async (req, res) => {
  try {
    const { firebaseUID } = req.params;

    const customer = await Customer.findOne({ firebaseUID }).lean();

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json(customer);
  } catch (err) {
    console.error("Get Customer By FirebaseUID Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

/* =========================================================
   GET ALL CUSTOMERS WITH FILTERS
========================================================= */

export const getAllCustomers = async (req, res) => {
  try {
    const {
      search,
      country,
      state,
      city,
      ageGroup,
      isActive,
      customerType,

      minOrders,
      maxOrders,
      minSpend,
      maxSpend,
      minRtoRate,
      maxRtoRate,
      minReturnRate,
      maxReturnRate,
      minRiskScore,
      maxRiskScore,

      hasCreditBalance,
      minCreditBalance,
      maxCreditBalance,
      minTotalCredited,
      maxTotalCredited,
      minTotalDebited,
      maxTotalDebited,

      sortBy = "createdAt",
      sortOrder = "desc",
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {
      ...(country && { country }),
      ...(state && { state }),
      ...(city && { city }),
      ...(ageGroup && { ageGroup }),
      ...(customerType && { "analytics.customerType": customerType }),
      ...(isActive !== undefined && { isActive: isActive === "true" }),
      ...(search && {
        $or: [
          { name: new RegExp(search, "i") },
          { email: new RegExp(search, "i") },
          { phone: new RegExp(search, "i") },
          { customerId: new RegExp(search, "i") },
          { firebaseUID: new RegExp(search, "i") },
          { referralCode: new RegExp(search, "i") },
        ],
      }),
    };

    const addRange = (path, min, max) => {
      if (!min && !max) return;

      filter[path] = {};
      if (min) filter[path].$gte = Number(min);
      if (max) filter[path].$lte = Number(max);
    };

    addRange("analytics.totalOrders", minOrders, maxOrders);
    addRange("analytics.totalSpend", minSpend, maxSpend);
    addRange("analytics.rtoRate", minRtoRate, maxRtoRate);
    addRange("analytics.returnRate", minReturnRate, maxReturnRate);
    addRange("analytics.riskScore", minRiskScore, maxRiskScore);

    addRange("credits.balance", minCreditBalance, maxCreditBalance);
    addRange("credits.totalCredited", minTotalCredited, maxTotalCredited);
    addRange("credits.totalDebited", minTotalDebited, maxTotalDebited);

    if (hasCreditBalance === "true") {
      filter["credits.balance"] = { ...(filter["credits.balance"] || {}), $gt: 0 };
    }

    if (hasCreditBalance === "false") {
      filter["credits.balance"] = { ...(filter["credits.balance"] || {}), $lte: 0 };
    }

    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const safePage = Math.max(1, Number(page) || 1);
    const skip = (safePage - 1) * safeLimit;

    const allowedSort = {
      createdAt: "createdAt",
      joinedAt: "joinedAt",

      totalOrders: "analytics.totalOrders",
      totalSpend: "analytics.totalSpend",
      avgOrderValue: "analytics.avgOrderValue",
      lastOrderAt: "analytics.lastOrderAt",
      rtoRate: "analytics.rtoRate",
      returnRate: "analytics.returnRate",
      riskScore: "analytics.riskScore",

      creditBalance: "credits.balance",
      totalCredited: "credits.totalCredited",
      totalDebited: "credits.totalDebited",
      lastCreditAt: "credits.lastCreditAt",
      lastDebitAt: "credits.lastDebitAt",
      refundCredits: "credits.totalRefundCredits",
      promotionCredits: "credits.totalPromotionCredits",
      influencerCredits: "credits.totalInfluencerCredits",
    };

    const sortField = allowedSort[sortBy] || "createdAt";
    const sortDirection = sortOrder === "asc" ? 1 : -1;

    const [items, total] = await Promise.all([
      Customer.find(filter)
        .sort({ [sortField]: sortDirection })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      Customer.countDocuments(filter),
    ]);

    return res.status(200).json({
      items,
      total,
      page: safePage,
      pages: Math.ceil(total / safeLimit),
      limit: safeLimit,
      filters: {
        search,
        country,
        state,
        city,
        ageGroup,
        isActive,
        customerType,
        hasCreditBalance,
      },
      sort: {
        sortBy,
        sortOrder,
      },
    });
  } catch (err) {
    console.error("Get Customers Error:", err);
    return res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};

/* =========================================================
   GET SINGLE CUSTOMER
========================================================= */

export const getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id)
      .populate("referredBy", "name email")
      .populate("preferences.categories", "name");

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json(customer);
  } catch (error) {
    console.error("Get Customer Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* =========================================================
   UPDATE CUSTOMER
========================================================= */

export const updateCustomer = async (req, res) => {
  try {
    const payload = { ...req.body };

    delete payload.firebaseUID;
    delete payload.customerId;
    delete payload.cart;
    delete payload.analytics;
    delete payload.credits;

    const ALLOWED_TOP_LEVEL = [
      "name",
      "email",
      "phone",
      "profileImage",
      "dateOfBirth",
      "gender",
      "country",
      "state",
      "city",
      "preferences",
      "referralCode",
      "referredBy",
      "isActive",
      "payoutDetails",
    ];

    for (const k of Object.keys(payload)) {
      if (!ALLOWED_TOP_LEVEL.includes(k)) delete payload[k];
    }

    if (payload.email) {
      payload.email = String(payload.email).trim().toLowerCase();
    }

    if (payload.phone) {
      payload.phone = String(payload.phone).trim();
    }

    if (payload.name) {
      payload.name = String(payload.name).trim();
    }

    if (payload.payoutDetails) {
      const bank = payload?.payoutDetails?.bank || {};
      const upi = payload?.payoutDetails?.upi || {};

      const safeAccountHolderName = bank?.accountHolderName
        ? String(bank.accountHolderName).trim()
        : "";

      const safeAccountNumber = bank?.accountNumber
        ? String(bank.accountNumber).trim()
        : "";

      const safeIfscCode = bank?.ifscCode
        ? String(bank.ifscCode).trim().toUpperCase()
        : "";

      const safeUpiId = upi?.upiId ? String(upi.upiId).trim().toLowerCase() : "";

      payload.payoutDetails = {
        bank: {
          accountHolderName: safeAccountHolderName,
          accountNumber: safeAccountNumber,
          ifscCode: safeIfscCode,
        },
        upi: { upiId: safeUpiId },
        updatedAt: new Date(),
      };
    }

    payload.updatedAt = new Date();

    const customer = await Customer.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json({ message: "Customer updated", customer });
  } catch (err) {
    console.error("Update Customer Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

/* =========================================================
   MANUAL UPDATE ANALYTICS
========================================================= */

export const updateCustomerAnalytics = async (req, res) => {
  try {
    const allowed = [
      "wishlistCount",
      "couponUses",
      "walletCreditsEarned",
    ];

    const $set = {
      updatedAt: new Date(),
    };

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        $set[`analytics.${key}`] = Number(req.body[key]) || 0;
      }
    }

    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      { $set },
      { new: true, runValidators: true }
    );

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json({
      message: "Analytics updated",
      customer,
    });
  } catch (err) {
    console.error("Update Analytics Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

/* =========================================================
   RECALCULATE CUSTOMER ANALYTICS FROM ORDERS
========================================================= */

export const syncCustomerAnalytics = async (req, res) => {
  try {
    const customer = await recalculateCustomerAnalytics(req.params.id);

    return res.status(200).json({
      message: "Customer analytics synced",
      customer,
    });
  } catch (err) {
    console.error("Sync Customer Analytics Error:", err);
    return res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};

/* =========================================================
   BULK RECALCULATE ALL CUSTOMER ANALYTICS
========================================================= */

export const syncAllCustomerAnalytics = async (req, res) => {
  try {
    const customers = await Customer.find({})
      .select("_id")
      .lean();

    let synced = 0;
    let failed = 0;

    for (const customer of customers) {
      try {
        await recalculateCustomerAnalytics(customer._id);
        synced += 1;
      } catch (err) {
        failed += 1;
        console.error(
          `Customer analytics sync failed for ${customer._id}:`,
          err.message
        );
      }
    }

    return res.status(200).json({
      message: "Customer analytics bulk sync completed",
      total: customers.length,
      synced,
      failed,
    });
  } catch (err) {
    console.error("Bulk Sync Customer Analytics Error:", err);
    return res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};

/* =========================================================
   CUSTOMER ANALYTICS SUMMARY
========================================================= */

export const getCustomerAnalyticsSummary = async (req, res) => {
  try {
    const [
      totalCustomers,
      activeCustomers,
      vipCustomers,
      repeatCustomers,
      riskyCustomers,
      inactiveCustomers,
      totals,
    ] = await Promise.all([
      Customer.countDocuments({}),
      Customer.countDocuments({ isActive: true }),
      Customer.countDocuments({ "analytics.customerType": "vip" }),
      Customer.countDocuments({ "analytics.customerType": "repeat" }),
      Customer.countDocuments({ "analytics.customerType": "risky" }),
      Customer.countDocuments({ "analytics.customerType": "inactive" }),
      Customer.aggregate([
        {
          $group: {
            _id: null,
            totalOrders: { $sum: "$analytics.totalOrders" },
            totalSpend: { $sum: "$analytics.totalSpend" },
            deliveredOrders: { $sum: "$analytics.deliveredOrders" },
            cancelledOrders: { $sum: "$analytics.cancelledOrders" },
            returnedOrders: { $sum: "$analytics.returnedOrders" },
            rtoOrders: { $sum: "$analytics.rtoOrders" },
            refundPendingOrders: { $sum: "$analytics.refundPendingOrders" },
          },
        },
      ]),
    ]);

    return res.status(200).json({
      totalCustomers,
      activeCustomers,
      inactiveAccountCustomers: totalCustomers - activeCustomers,
      segments: {
        vip: vipCustomers,
        repeat: repeatCustomers,
        risky: riskyCustomers,
        inactive: inactiveCustomers,
      },
      totals: totals?.[0] || {
        totalOrders: 0,
        totalSpend: 0,
        deliveredOrders: 0,
        cancelledOrders: 0,
        returnedOrders: 0,
        rtoOrders: 0,
        refundPendingOrders: 0,
      },
    });
  } catch (err) {
    console.error("Customer Analytics Summary Error:", err);
    return res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};

/* =========================================================
   DELETE CUSTOMER
========================================================= */

export const deleteCustomer = async (req, res) => {
  try {
    const deleted = await Customer.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json({ message: "Customer deleted successfully" });
  } catch (error) {
    console.error("Delete Customer Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* =========================================================
   CHECK CUSTOMER EXISTS
========================================================= */

export const checkCustomerExists = async (req, res) => {
  try {
    const { email = "", phone = "" } = req.query;

    const safeEmail = email ? String(email).trim().toLowerCase() : "";
    const safePhone = phone ? String(phone).trim() : "";

    if (!safeEmail && !safePhone) {
      return res.status(400).json({
        message: "Email or phone is required",
        exists: false,
      });
    }

    const query = {
      $or: [
        ...(safeEmail ? [{ email: safeEmail }] : []),
        ...(safePhone ? [{ phone: safePhone }] : []),
      ],
    };

    const customer = await Customer.findOne(query)
      .select("_id email phone name firebaseUID")
      .lean();

    return res.status(200).json({
      exists: !!customer,
      customer: customer || null,
    });
  } catch (err) {
    console.error("Check Customer Exists Error:", err);
    return res.status(500).json({
      message: "Server error",
      exists: false,
      error: err.message,
    });
  }
};

/* =========================================================
   ADD CART ADD
========================================================= */

export const addCartAddByCustomerId = async (req, res) => {
  try {
    const { id } = req.params;
    const { productCode = "", variantId = null, size = "" } = req.body;

    const code = String(productCode || "").trim();
    const sz = String(size || "").trim();
    const vId = variantId ? String(variantId).trim() : null;

    if (!code) {
      return res.status(400).json({ message: "productCode is required" });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    customer.cartAdds = Array.isArray(customer.cartAdds) ? customer.cartAdds : [];

    const sameKey = (x) =>
      String(x?.productCode || "").trim() === code &&
      (vId ? String(x?.variantId || "") === vId : String(x?.size || "").trim() === sz);

    customer.cartAdds = customer.cartAdds.filter((x) => !sameKey(x));

    customer.cartAdds.unshift({
      productCode: code,
      variantId: vId || null,
      size: sz || "",
      lastAddedAt: new Date(),
    });

    customer.cartAdds = customer.cartAdds.slice(0, 80);

    await customer.save();

    return res.status(200).json({
      message: "cartAdds updated",
      cartAdds: customer.cartAdds,
    });
  } catch (err) {
    console.error("Add CartAdd Error:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

/* =========================================================
   REMOVE CART ADD
========================================================= */

export const removeCartAddByCustomerId = async (req, res) => {
  try {
    const { id } = req.params;
    const { productCode = "", variantId = null, size = "" } = req.body;

    const code = String(productCode || "").trim();
    const sz = String(size || "").trim();
    const vId = variantId ? String(variantId).trim() : null;

    if (!code) {
      return res.status(400).json({ message: "productCode is required" });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    customer.cartAdds = Array.isArray(customer.cartAdds) ? customer.cartAdds : [];

    const shouldRemove = (x) => {
      if (String(x?.productCode || "").trim() !== code) return false;
      if (vId) return String(x?.variantId || "") === vId;
      if (sz) return String(x?.size || "").trim() === sz;
      return true;
    };

    const before = customer.cartAdds.length;
    customer.cartAdds = customer.cartAdds.filter((x) => !shouldRemove(x));
    const after = customer.cartAdds.length;

    if (before !== after) await customer.save();

    return res.status(200).json({
      message: "cartAdds updated",
      removed: before !== after,
      cartAdds: customer.cartAdds,
    });
  } catch (err) {
    console.error("Remove CartAdd Error:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

/* =========================================================
   MERGE GUEST CART ADDS
========================================================= */

export const mergeGuestCartAddsByCustomerId = async (req, res) => {
  try {
    const { id } = req.params;
    const { items = [] } = req.body;

    const normItems = (Array.isArray(items) ? items : [])
      .map((it) => {
        const productCode = String(it?.productCode || "").trim();
        const variantId = it?.variantId ? String(it.variantId).trim() : null;
        const size = String(it?.size || "").trim();
        const lastAddedAt = it?.lastAddedAt
          ? new Date(it.lastAddedAt)
          : new Date();

        if (!productCode) return null;

        return { productCode, variantId, size, lastAddedAt };
      })
      .filter(Boolean);

    if (!normItems.length) {
      return res.status(200).json({ message: "Nothing to merge", cartAdds: [] });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const existing = Array.isArray(customer.cartAdds) ? customer.cartAdds : [];

    const keyOf = (x) => {
      const code = String(x?.productCode || "").trim();
      const vId = x?.variantId ? String(x.variantId) : "";
      const sz = String(x?.size || "").trim();
      return `${code}::${vId || "-"}::${sz || "-"}`;
    };

    const m = new Map();

    const addToMap = (x) => {
      const k = keyOf(x);
      const prev = m.get(k);
      const t = x?.lastAddedAt ? new Date(x.lastAddedAt).getTime() : Date.now();
      const pt = prev?.lastAddedAt ? new Date(prev.lastAddedAt).getTime() : 0;

      if (!prev || t > pt) {
        m.set(k, {
          productCode: String(x.productCode).trim(),
          variantId: x.variantId ? String(x.variantId) : null,
          size: String(x.size || "").trim(),
          lastAddedAt: x.lastAddedAt ? new Date(x.lastAddedAt) : new Date(),
        });
      }
    };

    normItems.forEach(addToMap);
    existing.forEach(addToMap);

    const merged = Array.from(m.values())
      .sort((a, b) => new Date(b.lastAddedAt) - new Date(a.lastAddedAt))
      .slice(0, 80);

    customer.cartAdds = merged;
    await customer.save();

    return res.status(200).json({
      message: "cartAdds merged",
      cartAdds: customer.cartAdds,
    });
  } catch (err) {
    console.error("Merge Guest CartAdds Error:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

/* =========================================================
   ADD / UPDATE PAYOUT DETAILS
========================================================= */

export const addCustomerBankingDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const bankIn = req.body?.bank || req.body?.payoutDetails?.bank || {};
    const upiIn = req.body?.upi || req.body?.payoutDetails?.upi || {};

    const accountHolderName = bankIn?.accountHolderName
      ? String(bankIn.accountHolderName).trim()
      : "";

    const accountNumber = bankIn?.accountNumber
      ? String(bankIn.accountNumber).trim()
      : "";

    const ifscCode = bankIn?.ifscCode
      ? String(bankIn.ifscCode).trim().toUpperCase()
      : "";

    const upiId = upiIn?.upiId ? String(upiIn.upiId).trim().toLowerCase() : "";

    const hasAnyBank = !!(accountHolderName || accountNumber || ifscCode);
    const hasUpi = !!upiId;

    if (!hasAnyBank && !hasUpi) {
      return res.status(400).json({
        message: "Provide either UPI ID or Bank account details",
      });
    }

    if (hasAnyBank) {
      if (!accountHolderName || !accountNumber || !ifscCode) {
        return res.status(400).json({
          message:
            "For bank details, accountHolderName, accountNumber and ifscCode are required",
        });
      }
    }

    const $set = {
      updatedAt: new Date(),
      "payoutDetails.updatedAt": new Date(),
    };

    if (hasAnyBank) {
      $set["payoutDetails.bank.accountHolderName"] = accountHolderName;
      $set["payoutDetails.bank.accountNumber"] = accountNumber;
      $set["payoutDetails.bank.ifscCode"] = ifscCode;
    }

    if (hasUpi) {
      $set["payoutDetails.upi.upiId"] = upiId;
    }

    const customer = await Customer.findByIdAndUpdate(
      id,
      { $set },
      { new: true, runValidators: true }
    );

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    return res.status(200).json({
      message: "Payout details updated",
      payoutDetails: customer.payoutDetails,
      customer,
    });
  } catch (err) {
    console.error("Add Customer Banking Details Error:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

/* =========================================================
   CUSTOMER CREDITS / WALLET
========================================================= */

const CREDIT_TYPES = [
  "refund",
  "promotion",
  "influencer",
  "goodwill",
  "cashback",
  "referral_bonus",
  "manual_credit",
  "manual_debit",
  "order_usage",
  "order_adjustment",
  "expired",
  "other",
];

const normalizeCreditPayload = (body = {}) => {
  return {
    amount: Number(body.amount || 0),
    type: body.type ? String(body.type).trim() : "",
    reason: body.reason ? String(body.reason).trim() : "",
    notes: body.notes ? String(body.notes).trim() : "",

    orderId: body.orderId || null,
    orderNumber: body.orderNumber ? String(body.orderNumber).trim() : "",

    refundId: body.refundId || null,

    promotionName: body.promotionName
      ? String(body.promotionName).trim()
      : "",

    influencerName: body.influencerName
      ? String(body.influencerName).trim()
      : "",

    influencerCode: body.influencerCode
      ? String(body.influencerCode).trim().toUpperCase()
      : "",

    couponId: body.couponId || null,

    couponCode: body.couponCode
      ? String(body.couponCode).trim().toUpperCase()
      : "",

    addedBy: body.addedBy ? String(body.addedBy).trim() : "admin",
    adminId: body.adminId || null,

    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
  };
};

/**
 * ✅ Add customer credit
 * Refund / promotion / influencer / goodwill / cashback etc.
 */
export const addCustomerCredit = async (req, res) => {
  try {
    const { id } = req.params;

    const payload = normalizeCreditPayload(req.body);

    if (!payload.amount || payload.amount <= 0) {
      return res.status(400).json({
        message: "Valid amount is required",
      });
    }

    if (!payload.type || !CREDIT_TYPES.includes(payload.type)) {
      return res.status(400).json({
        message: "Valid credit type is required",
        allowedTypes: CREDIT_TYPES,
      });
    }

    if (!payload.reason) {
      return res.status(400).json({
        message: "Reason is required",
      });
    }

    const customer = await Customer.findById(id);

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    customer.credits = customer.credits || {};
    customer.credits.balance = Number(customer.credits.balance || 0);
    customer.credits.totalCredited = Number(customer.credits.totalCredited || 0);
    customer.credits.totalDebited = Number(customer.credits.totalDebited || 0);
    customer.credits.logs = Array.isArray(customer.credits.logs)
      ? customer.credits.logs
      : [];

    const newBalance = customer.credits.balance + payload.amount;

    const log = {
      transactionType: "credit",
      type: payload.type,
      amount: payload.amount,
      balanceAfterTransaction: newBalance,

      reason: payload.reason,
      notes: payload.notes,

      orderId: payload.orderId,
      orderNumber: payload.orderNumber,

      refundId: payload.refundId,

      promotionName: payload.promotionName,
      influencerName: payload.influencerName,
      influencerCode: payload.influencerCode,

      couponId: payload.couponId,
      couponCode: payload.couponCode,

      addedBy: payload.addedBy,
      adminId: payload.adminId,

      expiresAt: payload.expiresAt,
      isExpired: false,

      createdAt: new Date(),
    };

    customer.credits.balance = newBalance;
    customer.credits.totalCredited += payload.amount;
    customer.credits.lastCreditAt = new Date();

    if (payload.type === "refund") {
      customer.credits.totalRefundCredits =
        Number(customer.credits.totalRefundCredits || 0) + payload.amount;
    }

    if (payload.type === "promotion") {
      customer.credits.totalPromotionCredits =
        Number(customer.credits.totalPromotionCredits || 0) + payload.amount;
    }

    if (payload.type === "influencer") {
      customer.credits.totalInfluencerCredits =
        Number(customer.credits.totalInfluencerCredits || 0) + payload.amount;
    }

    customer.analytics = customer.analytics || {};
    customer.analytics.walletCreditsEarned =
      Number(customer.analytics.walletCreditsEarned || 0) + payload.amount;

    customer.credits.logs.unshift(log);

    // optional safety limit
    customer.credits.logs = customer.credits.logs.slice(0, 300);

    await customer.save();

    return res.status(200).json({
      message: "Customer credit added",
      credits: customer.credits,
      customer,
    });
  } catch (err) {
    console.error("Add Customer Credit Error:", err);
    return res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};

/**
 * ✅ Debit / use customer credit
 * Used while order payment, manual debit, expired credit etc.
 */
export const debitCustomerCredit = async (req, res) => {
  try {
    const { id } = req.params;

    const payload = normalizeCreditPayload(req.body);

    if (!payload.amount || payload.amount <= 0) {
      return res.status(400).json({
        message: "Valid amount is required",
      });
    }

    const allowedDebitTypes = [
      "manual_debit",
      "order_usage",
      "order_adjustment",
      "expired",
      "other",
    ];

    if (!payload.type || !allowedDebitTypes.includes(payload.type)) {
      return res.status(400).json({
        message: "Valid debit type is required",
        allowedTypes: allowedDebitTypes,
      });
    }

    if (!payload.reason) {
      return res.status(400).json({
        message: "Reason is required",
      });
    }

    const customer = await Customer.findById(id);

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    customer.credits = customer.credits || {};
    customer.credits.balance = Number(customer.credits.balance || 0);
    customer.credits.totalDebited = Number(customer.credits.totalDebited || 0);
    customer.credits.logs = Array.isArray(customer.credits.logs)
      ? customer.credits.logs
      : [];

    if (customer.credits.balance < payload.amount) {
      return res.status(400).json({
        message: "Insufficient credit balance",
        availableBalance: customer.credits.balance,
      });
    }

    const newBalance = customer.credits.balance - payload.amount;

    const log = {
      transactionType: "debit",
      type: payload.type,
      amount: payload.amount,
      balanceAfterTransaction: newBalance,

      reason: payload.reason,
      notes: payload.notes,

      orderId: payload.orderId,
      orderNumber: payload.orderNumber,

      refundId: payload.refundId,

      promotionName: payload.promotionName,
      influencerName: payload.influencerName,
      influencerCode: payload.influencerCode,

      couponId: payload.couponId,
      couponCode: payload.couponCode,

      addedBy: payload.addedBy,
      adminId: payload.adminId,

      expiresAt: payload.expiresAt,
      isExpired: payload.type === "expired",

      createdAt: new Date(),
    };

    customer.credits.balance = newBalance;
    customer.credits.totalDebited += payload.amount;
    customer.credits.lastDebitAt = new Date();

    customer.credits.logs.unshift(log);
    customer.credits.logs = customer.credits.logs.slice(0, 300);

    await customer.save();

    return res.status(200).json({
      message: "Customer credit debited",
      credits: customer.credits,
      customer,
    });
  } catch (err) {
    console.error("Debit Customer Credit Error:", err);
    return res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};

/**
 * ✅ Get customer credit logs
 */
export const getCustomerCreditLogs = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      type,
      transactionType,
      orderNumber,
      influencerCode,
      page = 1,
      limit = 20,
    } = req.query;

    const customer = await Customer.findById(id)
      .select("customerId name email phone credits")
      .lean();

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    let logs = customer?.credits?.logs || [];

    if (type) {
      logs = logs.filter((log) => log.type === type);
    }

    if (transactionType) {
      logs = logs.filter((log) => log.transactionType === transactionType);
    }

    if (orderNumber) {
      const safeOrderNumber = String(orderNumber).trim().toLowerCase();
      logs = logs.filter((log) =>
        String(log.orderNumber || "").toLowerCase().includes(safeOrderNumber)
      );
    }

    if (influencerCode) {
      const safeCode = String(influencerCode).trim().toUpperCase();
      logs = logs.filter((log) => log.influencerCode === safeCode);
    }

    logs = logs.sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );

    const safeLimit = Math.min(100, Math.max(1, Number(limit)));
    const safePage = Math.max(1, Number(page));
    const skip = (safePage - 1) * safeLimit;

    const paginatedLogs = logs.slice(skip, skip + safeLimit);

    return res.status(200).json({
      customer: {
        _id: customer._id,
        customerId: customer.customerId,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      },
      summary: {
        balance: customer?.credits?.balance || 0,
        totalCredited: customer?.credits?.totalCredited || 0,
        totalDebited: customer?.credits?.totalDebited || 0,
        totalRefundCredits: customer?.credits?.totalRefundCredits || 0,
        totalPromotionCredits: customer?.credits?.totalPromotionCredits || 0,
        totalInfluencerCredits: customer?.credits?.totalInfluencerCredits || 0,
      },
      items: paginatedLogs,
      total: logs.length,
      page: safePage,
      pages: Math.ceil(logs.length / safeLimit),
      limit: safeLimit,
    });
  } catch (err) {
    console.error("Get Customer Credit Logs Error:", err);
    return res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};

export const getAllCustomerCreditLogs = async (req, res) => {
  try {
    const {
      type,
      transactionType,
      orderNumber,
      influencerCode,
      couponCode,
      search,
      from,
      to,
      sortOrder = "desc",
    } = req.query;

    const { page, limit, skip } = getPagination(req.query);

    const match = {};

    if (type) match["credits.logs.type"] = type;
    if (transactionType) match["credits.logs.transactionType"] = transactionType;
    if (orderNumber) match["credits.logs.orderNumber"] = new RegExp(orderNumber, "i");
    if (influencerCode) match["credits.logs.influencerCode"] = String(influencerCode).trim().toUpperCase();
    if (couponCode) match["credits.logs.couponCode"] = String(couponCode).trim().toUpperCase();

    const createdAtRange = dateRangeFilter(from, to);
    if (createdAtRange) match["credits.logs.createdAt"] = createdAtRange;

    if (search) {
      const regex = new RegExp(String(search).trim(), "i");

      match.$or = [
        { "credits.logs.creditId": regex },
        { "credits.logs.reason": regex },
        { "credits.logs.notes": regex },
        { "credits.logs.orderNumber": regex },
        { "credits.logs.promotionName": regex },
        { "credits.logs.influencerName": regex },
        { "credits.logs.influencerCode": regex },
        { "credits.logs.couponCode": regex },
        { name: regex },
        { email: regex },
        { phone: regex },
        { customerId: regex },
      ];
    }

    const pipeline = [
      { $unwind: "$credits.logs" },
      { $match: match },
      {
        $project: {
          _id: 0,
          customer: {
            _id: "$_id",
            customerId: "$customerId",
            name: "$name",
            email: "$email",
            phone: "$phone",
          },
          log: "$credits.logs",
        },
      },
      {
        $sort: {
          "log.createdAt": sortOrder === "asc" ? 1 : -1,
        },
      },
      {
        $facet: {
          items: [{ $skip: skip }, { $limit: limit }],
          meta: [{ $count: "total" }],
        },
      },
    ];

    const result = await Customer.aggregate(pipeline);

    const items = result?.[0]?.items || [];
    const total = result?.[0]?.meta?.[0]?.total || 0;

    return res.status(200).json({
      items,
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    });
  } catch (err) {
    console.error("Get All Customer Credit Logs Error:", err);
    return res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};

export const getCustomerCreditSummary = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findById(id)
      .select("customerId name email phone credits")
      .lean();

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    return res.status(200).json({
      success: true,
      customer: {
        _id: customer._id,
        customerId: customer.customerId,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      },
      credits: {
        balance: customer?.credits?.balance || 0,
        totalCredited: customer?.credits?.totalCredited || 0,
        totalDebited: customer?.credits?.totalDebited || 0,
        totalRefundCredits: customer?.credits?.totalRefundCredits || 0,
        totalPromotionCredits: customer?.credits?.totalPromotionCredits || 0,
        totalInfluencerCredits: customer?.credits?.totalInfluencerCredits || 0,
        lastCreditAt: customer?.credits?.lastCreditAt || null,
        lastDebitAt: customer?.credits?.lastDebitAt || null,
      },
    });
  } catch (err) {
    console.error("Get Customer Credit Summary Error:", err);
    return res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};