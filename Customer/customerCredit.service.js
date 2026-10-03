import Customer from "./Customer.js";
import { Mailer } from "../nodemailer/mailer.js";
import { sendCustomerCreditWhatsapp } from "../fast2sms/fast2sms.whatsapp.js";

const CREDIT_LOG_LIMIT = 300;

const num = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const str = (value) =>
  value == null ? "" : String(value).trim();

const makeCreditId = () =>
  `CR-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

const getCreditExpiry = (createdAt) => {
  const expiresAt = new Date(createdAt);
  const originalMonth = expiresAt.getUTCMonth();

  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);

  // February 29 expires on February 28 in a non-leap year.
  if (expiresAt.getUTCMonth() !== originalMonth) {
    expiresAt.setUTCDate(0);
  }

  return expiresAt;
};

const saveCustomer = async (customer, session) => {
  await customer.save(session ? { session } : {});
};

const notifyRefundCredit = async ({
  customer,
  amount,
  balance,
  log,
  orderNumber = "",
}) => {
  const jobs = [];

  if (customer?.email) {
    jobs.push(
      Promise.resolve().then(() =>
        Mailer.sendCustomerCreditCredited({
          to: customer.email,
          name: customer.name || "Customer",
          amount,
          balance,
          orderNumber,
          creditId: log?.creditId || "",
          reason: "Refund",
          creditedAt: log?.createdAt || new Date(),
          ctaUrl: `${process.env.CLIENT_URL || "https://oatclub.in"}/account`,
        }),
      ),
    );
  }

  if (customer?.phone) {
    jobs.push(
      Promise.resolve().then(() =>
        sendCustomerCreditWhatsapp({
          phone: customer.phone,
          customerName: customer.name || "Customer",
          amount,
          creditId: log?.creditId || "",
        }),
      ),
    );
  }

  if (!jobs.length) return;

  const results = await Promise.allSettled(jobs);

  results.forEach((result) => {
    if (result.status === "rejected") {
      console.error(
        "Refund credit notification failed:",
        result.reason?.message || result.reason,
      );
    }
  });
};

const getCustomerById = async ({
  customerId,
  session = null,
}) => {
  const query = Customer.findById(customerId);

  if (session) query.session(session);

  const customer = await query;

  if (!customer) {
    throw new Error("Customer not found");
  }

  customer.credits = customer.credits || {};

  customer.credits.balance = num(customer.credits.balance);
  customer.credits.totalCredited = num(
    customer.credits.totalCredited,
  );
  customer.credits.totalDebited = num(
    customer.credits.totalDebited,
  );
  customer.credits.totalRefundCredits = num(
    customer.credits.totalRefundCredits,
  );
  customer.credits.totalPromotionCredits = num(
    customer.credits.totalPromotionCredits,
  );
  customer.credits.totalInfluencerCredits = num(
    customer.credits.totalInfluencerCredits,
  );

  customer.credits.logs = Array.isArray(customer.credits.logs)
    ? customer.credits.logs
    : [];

  customer.analytics = customer.analytics || {};
  customer.expireCreditBatches();

  if (customer.isModified("credits")) {
    await customer.save(session ? { session } : {});
  }
  return customer;
};

/* =========================================================
   BALANCE
========================================================= */

export const getCustomerCreditBalanceInternal = async ({
  customerId,
  session = null,
}) => {
  const customer = await getCustomerById({
    customerId,
    session,
  });

  return {
    customerId: customer._id,
    balance: num(customer.credits.balance),
    totalCredited: num(customer.credits.totalCredited),
    totalDebited: num(customer.credits.totalDebited),
  };
};

export const validateCustomerCreditBalanceInternal = async ({
  customerId,
  amount,
  session = null,
}) => {
  const safeAmount = num(amount);

  if (safeAmount <= 0) {
    throw new Error("Invalid wallet amount");
  }

  const customer = await getCustomerById({
    customerId,
    session,
  });

  if (customer.credits.balance < safeAmount) {
    throw new Error("Insufficient wallet balance");
  }

  return {
    customer,
    balance: customer.credits.balance,
    requestedAmount: safeAmount,
  };
};

/* =========================================================
   ADD CREDIT — ONE-YEAR VALIDITY
========================================================= */

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

  session = null,
}) => {
  const safeAmount = num(amount);

  if (safeAmount <= 0) {
    throw new Error("Invalid credit amount");
  }

  const customer = await getCustomerById({
    customerId,
    session,
  });

  const creditedAt = new Date();
  const expiresAt = getCreditExpiry(creditedAt);

  const newBalance = customer.credits.balance + safeAmount;

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
    createdAt: creditedAt,
  };

  customer.credits.batches.push({
    creditId: log.creditId,
    amount: safeAmount,
    remainingAmount: safeAmount,
    createdAt: log.createdAt,
    expiresAt: log.expiresAt,
    isExpired: false,
    isLegacy: false,
  });

  customer.credits.balance = newBalance;
  customer.credits.totalCredited += safeAmount;
  customer.credits.lastCreditAt = creditedAt;

  if (type === "refund") {
    customer.credits.totalRefundCredits += safeAmount;
  }

  if (
    ["promotion", "cashback", "referral_bonus"].includes(type)
  ) {
    customer.credits.totalPromotionCredits += safeAmount;
  }

  if (type === "influencer") {
    customer.credits.totalInfluencerCredits += safeAmount;
  }

  customer.analytics.walletCreditsEarned =
    num(customer.analytics.walletCreditsEarned) + safeAmount;

  customer.credits.logs.unshift(log);
  customer.credits.logs = customer.credits.logs.slice(
    0,
    CREDIT_LOG_LIMIT,
  );

  await saveCustomer(customer, session);

  return {
    customer,
    log,
    balance: newBalance,
  };
};

/* =========================================================
   DEBIT CREDIT
   Expiry enforcement requires the upcoming allocation patch.
========================================================= */

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

  if (safeAmount <= 0) {
    throw new Error("Invalid debit amount");
  }

  const customer = await getCustomerById({
    customerId,
    session,
  });

  if (customer.credits.balance < safeAmount) {
    throw new Error("Insufficient wallet balance");
  }

  const debitedAt = new Date();
  customer.consumeCreditBatches(safeAmount);
  const newBalance = customer.credits.balance - safeAmount;

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

    expiresAt: null,
    isExpired: type === "expired",
    createdAt: debitedAt,
  };

  customer.credits.balance = newBalance;
  customer.credits.totalDebited += safeAmount;
  customer.credits.lastDebitAt = debitedAt;

  customer.credits.logs.unshift(log);
  customer.credits.logs = customer.credits.logs.slice(
    0,
    CREDIT_LOG_LIMIT,
  );

  await saveCustomer(customer, session);

  return {
    customer,
    log,
    balance: newBalance,
  };
};

/* =========================================================
   ORDER WALLET USAGE
========================================================= */

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
    notes: orderNumber
      ? `Wallet used for order ${orderNumber}`
      : "",
    orderId,
    orderNumber,
    addedBy: "system",
    session,
  });
};

/* =========================================================
   REFUND CREDIT
========================================================= */

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
  const result = await addCustomerCreditInternal({
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

  // With a session, the caller must notify after transaction commit.
  if (!session) {
    await notifyRefundCredit({
      customer: result.customer,
      amount: result.log.amount,
      balance: result.balance,
      log: result.log,
      orderNumber,
    });
  }

  return result;
};

/* =========================================================
   REVERSE ORDER WALLET DEBIT
   Existing behavior: issue fresh credit with one-year validity.
========================================================= */

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

/* =========================================================
   MANUAL CREDIT
========================================================= */

export const manualCreditCustomerInternal = async ({
  customerId,
  amount,
  reason,
  notes = "",
  adminId = null,
  session = null,
}) => {
  if (!str(reason)) {
    throw new Error("Reason is required for manual credit");
  }

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

/* =========================================================
   MANUAL DEBIT
========================================================= */

export const manualDebitCustomerInternal = async ({
  customerId,
  amount,
  reason,
  notes = "",
  adminId = null,
  session = null,
}) => {
  if (!str(reason)) {
    throw new Error("Reason is required for manual debit");
  }

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
