import Customer from "./Customer.js";

const CREDIT_LOG_LIMIT = 300;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const str = (v) => (v == null ? "" : String(v).trim());

const makeCreditId = () =>
  `CR-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

const getCustomerById = async ({ customerId, session = null }) => {
  const query = Customer.findById(customerId);
  if (session) query.session(session);

  const customer = await query;
  if (!customer) throw new Error("Customer not found");

  customer.credits = customer.credits || {};
  customer.credits.balance = num(customer.credits.balance);
  customer.credits.totalCredited = num(customer.credits.totalCredited);
  customer.credits.totalDebited = num(customer.credits.totalDebited);
  customer.credits.totalRefundCredits = num(customer.credits.totalRefundCredits);
  customer.credits.totalPromotionCredits = num(customer.credits.totalPromotionCredits);
  customer.credits.totalInfluencerCredits = num(customer.credits.totalInfluencerCredits);
  customer.credits.logs = Array.isArray(customer.credits.logs)
    ? customer.credits.logs
    : [];

  customer.analytics = customer.analytics || {};

  return customer;
};

export const getCustomerCreditBalanceInternal = async ({
  customerId,
  session = null,
}) => {
  const customer = await getCustomerById({ customerId, session });

  return {
    customerId: customer._id,
    balance: num(customer.credits?.balance),
    totalCredited: num(customer.credits?.totalCredited),
    totalDebited: num(customer.credits?.totalDebited),
  };
};

export const validateCustomerCreditBalanceInternal = async ({
  customerId,
  amount,
  session = null,
}) => {
  const safeAmount = num(amount);
  if (safeAmount <= 0) throw new Error("Invalid wallet amount");

  const customer = await getCustomerById({ customerId, session });

  if (num(customer.credits.balance) < safeAmount) {
    throw new Error("Insufficient wallet balance");
  }

  return {
    customer,
    balance: num(customer.credits.balance),
    requestedAmount: safeAmount,
  };
};

export const addCustomerCreditInternal = async ({
  customerId,
  amount,
  type = "refund",
  reason = "",
  notes = "",

  orderId = null,
  orderNumber = "",
  refundId = null,

  promotionName = "",
  influencerName = "",
  influencerCode = "",
  couponId = null,
  couponCode = "",

  addedBy = "system",
  adminId = null,
  expiresAt = null,

  session = null,
}) => {
  const safeAmount = num(amount);
  if (safeAmount <= 0) throw new Error("Invalid credit amount");

  const customer = await getCustomerById({ customerId, session });

  const newBalance = num(customer.credits.balance) + safeAmount;

  const log = {
    creditId: makeCreditId(),
    transactionType: "credit",
    type,
    amount: safeAmount,
    balanceAfterTransaction: newBalance,
    reason: str(reason),
    notes: str(notes),

    orderId,
    orderNumber: str(orderNumber),
    refundId,

    promotionName: str(promotionName),
    influencerName: str(influencerName),
    influencerCode: str(influencerCode).toUpperCase(),
    couponId,
    couponCode: str(couponCode).toUpperCase(),

    addedBy,
    adminId,
    expiresAt,
    isExpired: false,
    createdAt: new Date(),
  };

  customer.credits.balance = newBalance;
  customer.credits.totalCredited += safeAmount;
  customer.credits.lastCreditAt = new Date();

  if (type === "refund") {
    customer.credits.totalRefundCredits += safeAmount;
  }

  if (["promotion", "cashback", "referral_bonus"].includes(type)) {
    customer.credits.totalPromotionCredits += safeAmount;
  }

  if (type === "influencer") {
    customer.credits.totalInfluencerCredits += safeAmount;
  }

  customer.analytics.walletCreditsEarned =
    num(customer.analytics.walletCreditsEarned) + safeAmount;

  customer.credits.logs.unshift(log);
  customer.credits.logs = customer.credits.logs.slice(0, CREDIT_LOG_LIMIT);

  await customer.save({ session });

  return {
    customer,
    log,
    balance: newBalance,
  };
};

export const debitCustomerCreditInternal = async ({
  customerId,
  amount,
  type = "order_usage",
  reason = "",
  notes = "",

  orderId = null,
  orderNumber = "",
  refundId = null,

  addedBy = "system",
  adminId = null,

  session = null,
}) => {
  const safeAmount = num(amount);
  if (safeAmount <= 0) throw new Error("Invalid debit amount");

  const customer = await getCustomerById({ customerId, session });

  if (num(customer.credits.balance) < safeAmount) {
    throw new Error("Insufficient wallet balance");
  }

  const newBalance = num(customer.credits.balance) - safeAmount;

  const log = {
    creditId: makeCreditId(),
    transactionType: "debit",
    type,
    amount: safeAmount,
    balanceAfterTransaction: newBalance,
    reason: str(reason),
    notes: str(notes),

    orderId,
    orderNumber: str(orderNumber),
    refundId,

    addedBy,
    adminId,
    createdAt: new Date(),
  };

  customer.credits.balance = newBalance;
  customer.credits.totalDebited += safeAmount;
  customer.credits.lastDebitAt = new Date();

  customer.credits.logs.unshift(log);
  customer.credits.logs = customer.credits.logs.slice(0, CREDIT_LOG_LIMIT);

  await customer.save({ session });

  return {
    customer,
    log,
    balance: newBalance,
  };
};

export const debitWalletForOrderInternal = async ({
  customerId,
  amount,
  orderId,
  orderNumber,
  session = null,
}) => {
  return debitCustomerCreditInternal({
    customerId,
    amount,
    type: "order_usage",
    reason: "Wallet credit used on order",
    notes: orderNumber ? `Wallet used for order ${orderNumber}` : "",
    orderId,
    orderNumber,
    addedBy: "system",
    session,
  });
};

export const creditWalletForRefundInternal = async ({
  customerId,
  amount,
  orderId = null,
  orderNumber = "",
  refundId = null,
  reason = "Refund issued as wallet credit",
  notes = "",
  addedBy = "system",
  adminId = null,
  session = null,
}) => {
  return addCustomerCreditInternal({
    customerId,
    amount,
    type: "refund",
    reason,
    notes,
    orderId,
    orderNumber,
    refundId,
    addedBy,
    adminId,
    session,
  });
};

export const rollbackOrderWalletDebitInternal = async ({
  customerId,
  amount,
  orderId = null,
  orderNumber = "",
  reason = "Wallet debit reversed",
  notes = "",
  session = null,
}) => {
  return addCustomerCreditInternal({
    customerId,
    amount,
    type: "order_adjustment",
    reason,
    notes,
    orderId,
    orderNumber,
    addedBy: "system",
    session,
  });
};

export const manualCreditCustomerInternal = async ({
  customerId,
  amount,
  reason,
  notes = "",
  adminId = null,
  session = null,
}) => {
  if (!str(reason)) throw new Error("Reason is required for manual credit");

  return addCustomerCreditInternal({
    customerId,
    amount,
    type: "manual_credit",
    reason,
    notes,
    addedBy: "admin",
    adminId,
    session,
  });
};

export const manualDebitCustomerInternal = async ({
  customerId,
  amount,
  reason,
  notes = "",
  adminId = null,
  session = null,
}) => {
  if (!str(reason)) throw new Error("Reason is required for manual debit");

  return debitCustomerCreditInternal({
    customerId,
    amount,
    type: "manual_debit",
    reason,
    notes,
    addedBy: "admin",
    adminId,
    session,
  });
};