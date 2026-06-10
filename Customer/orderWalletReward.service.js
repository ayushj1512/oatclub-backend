import Order from "../Orders/Orders.js";
import { addCustomerCreditInternal } from "./customerCredit.service.js";

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const lower = (value) => String(value || "").trim().toLowerCase();

export const creditOrderWalletRewardInternal = async ({
  orderId,
  percent = 1,
  session = null,
} = {}) => {
  if (!orderId) return null;

  const query = Order.findById(orderId);
  if (session) query.session(session);

  const order = await query;
  if (!order) return null;

  if (order.walletReward?.earned) {
    return {
      skipped: true,
      reason: "already_credited",
      amount: num(order.walletReward.amount),
      order,
    };
  }

  const method = lower(order.paymentMethod);
  const status = lower(order.paymentStatus);
  const isPaid = status === "paid" || method === "cod" || method === "wallet";

  if (!isPaid || method === "exchange") {
    return { skipped: true, reason: "not_rewardable", order };
  }

  const base = num(order.finalPayable || order.totalAmount || order.subtotal);
  const rewardAmount = Math.floor((base * num(percent)) / 100);

  if (rewardAmount <= 0 || !order.customerId) {
    return { skipped: true, reason: "invalid_amount", order };
  }

  const credit = await addCustomerCreditInternal({
    customerId: order.customerId,
    amount: rewardAmount,
    type: "cashback",
    reason: "OATCLUB order wallet reward",
    notes: `1% wallet reward for order ${order.orderNumber || order._id}`,
    orderId: order._id,
    orderNumber: order.orderNumber || "",
    addedBy: "system",
    session,
  });

  order.walletReward = {
    earned: true,
    amount: rewardAmount,
    percent: num(percent),
    transactionId: credit?.log?.creditId || "",
    creditedAt: new Date(),
    balanceAfterCredit: num(credit?.balance),
  };

  await order.save(session ? { session } : undefined);

  return {
    skipped: false,
    amount: rewardAmount,
    balance: credit?.balance,
    log: credit?.log,
    order,
  };
};
