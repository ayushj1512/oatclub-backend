import Customer from "./Customer.js";
import Order from "../Orders/Orders.js"; // ✅ adjust path if your Order model path is different
import { Mailer } from "../nodemailer/events/mailer.js";

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
      brandName: "Miray Fashions",
      supportEmail: process.env.MAIL_REPLY_TO || "support@mirayfashions.com",
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

    const before = await Customer.findOne(filter).select("email").lean();
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

    const $setOnInsert = {
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
        ],
      }),
    };

    if (minOrders || maxOrders) {
      filter["analytics.totalOrders"] = {};
      if (minOrders) filter["analytics.totalOrders"].$gte = Number(minOrders);
      if (maxOrders) filter["analytics.totalOrders"].$lte = Number(maxOrders);
    }

    if (minSpend || maxSpend) {
      filter["analytics.totalSpend"] = {};
      if (minSpend) filter["analytics.totalSpend"].$gte = Number(minSpend);
      if (maxSpend) filter["analytics.totalSpend"].$lte = Number(maxSpend);
    }

    if (minRtoRate || maxRtoRate) {
      filter["analytics.rtoRate"] = {};
      if (minRtoRate) filter["analytics.rtoRate"].$gte = Number(minRtoRate);
      if (maxRtoRate) filter["analytics.rtoRate"].$lte = Number(maxRtoRate);
    }

    if (minReturnRate || maxReturnRate) {
      filter["analytics.returnRate"] = {};
      if (minReturnRate) {
        filter["analytics.returnRate"].$gte = Number(minReturnRate);
      }
      if (maxReturnRate) {
        filter["analytics.returnRate"].$lte = Number(maxReturnRate);
      }
    }

    if (minRiskScore || maxRiskScore) {
      filter["analytics.riskScore"] = {};
      if (minRiskScore) {
        filter["analytics.riskScore"].$gte = Number(minRiskScore);
      }
      if (maxRiskScore) {
        filter["analytics.riskScore"].$lte = Number(maxRiskScore);
      }
    }

    const safeLimit = Math.min(100, Math.max(1, Number(limit)));
    const safePage = Math.max(1, Number(page));
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

    res.json({
      items,
      total,
      page: safePage,
      pages: Math.ceil(total / safeLimit),
      limit: safeLimit,
    });
  } catch (err) {
    console.error("Get Customers Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
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
      "creditsEarned",
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