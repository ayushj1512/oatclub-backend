import Customer from "./Customer.js";
import Order from "../Orders/Orders.js"; // adjust path if needed

/* =========================================================
   HELPERS
========================================================= */

const percentage = (part, total) => {
  const p = Number(part || 0);
  const t = Number(total || 0);
  if (!t) return 0;
  return Number(((p / t) * 100).toFixed(2));
};

const getOrderDate = (order) =>
  order?.orderDate || order?.createdAt || order?.updatedAt || null;

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

const getCustomerType = ({
  totalOrders,
  totalSpend,
  rtoRate,
  returnRate,
  cancellationRate,
  lastOrderAt,
}) => {
  const now = Date.now();
  const lastOrderTime = lastOrderAt
    ? new Date(lastOrderAt).getTime()
    : null;

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

/* =========================================================
   MAIN SERVICE
========================================================= */

/**
 * 🔥 Recalculate full customer analytics
 * Source of truth: Orders collection
 */
export const recalculateCustomerAnalytics = async (customerId) => {
  if (!customerId) return;

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

  /* ========================
     BASIC METRICS
  ======================== */

  const totalSpend = orders.reduce((sum, o) => {
    const val = Number(o?.finalPayable ?? o?.totalAmount ?? 0);
    return sum + val;
  }, 0);

  const values = orders
    .map((o) => Number(o?.finalPayable ?? o?.totalAmount ?? 0))
    .filter((v) => v > 0);

  const avgOrderValue = totalOrders
    ? Number((totalSpend / totalOrders).toFixed(2))
    : 0;

  /* ========================
     COUNTERS
  ======================== */

  const countByFulfillment = (status) =>
    orders.filter((o) => o.fulfillmentStatus === status).length;

  const countByPaymentMethod = (method) =>
    orders.filter((o) => o.paymentMethod === method).length;

  const countByPaymentStatus = (status) =>
    orders.filter((o) => o.paymentStatus === status).length;

  /* ========================
     FULFILLMENT
  ======================== */

  const deliveredOrders = countByFulfillment("delivered");
  const cancelledOrders = countByFulfillment("cancelled");
  const returnedOrders = countByFulfillment("returned");
  const rtoOrders = countByFulfillment("rto");

  const processingOrders = countByFulfillment("processing");
  const packedOrders = countByFulfillment("packed");
  const pickedOrders = countByFulfillment("picked");
  const shippedOrders = countByFulfillment("shipped");
  const outForDeliveryOrders = countByFulfillment("out_for_delivery");

  const returnRequestedOrders = countByFulfillment("return_requested");
  const exchangeRequestedOrders = countByFulfillment("exchange_requested");
  const exchangedOrders = countByFulfillment("exchanged");
  const failedOrders = countByFulfillment("failed");
  const refundedOrdersByFulfillment = countByFulfillment("refunded");

  /* ========================
     PAYMENT
  ======================== */

  const codOrders = countByPaymentMethod("cod");
  const prepaidOrders = countByPaymentMethod("razorpay");
  const exchangeOrders = countByPaymentMethod("exchange");

  const paidOrders = countByPaymentStatus("paid");
  const paymentPendingOrders = countByPaymentStatus("pending");
  const paymentFailedOrders = countByPaymentStatus("failed");
  const refundPendingOrders = countByPaymentStatus("refund_pending");
  const refundedOrders = countByPaymentStatus("refunded");

  /* ========================
     CONFIRMATION
  ======================== */

  const confirmedOrders = orders.filter((o) => o.isConfirmed).length;
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

  /* ========================
     DATES
  ======================== */

  const sortedOrders = [...orders].sort((a, b) => {
    const da = getOrderDate(a) ? new Date(getOrderDate(a)).getTime() : 0;
    const db = getOrderDate(b) ? new Date(getOrderDate(b)).getTime() : 0;
    return da - db;
  });

  const firstOrderAt = sortedOrders[0]
    ? getOrderDate(sortedOrders[0])
    : null;

  const lastOrderAt =
    sortedOrders[sortedOrders.length - 1]
      ? getOrderDate(sortedOrders[sortedOrders.length - 1])
      : null;

  /* ========================
     RATES
  ======================== */

  const deliveryRate = percentage(deliveredOrders, totalOrders);
  const cancellationRate = percentage(cancelledOrders, totalOrders);
  const returnRate = percentage(returnedOrders, totalOrders);
  const rtoRate = percentage(rtoOrders, totalOrders);
  const paymentSuccessRate = percentage(paidOrders, totalOrders);

  const riskScore = Math.min(
    100,
    Number(
      (rtoRate * 0.45 +
        returnRate * 0.35 +
        cancellationRate * 0.2).toFixed(2)
    )
  );

  const customerType = getCustomerType({
    totalOrders,
    totalSpend,
    rtoRate,
    returnRate,
    cancellationRate,
    lastOrderAt,
  });

  /* ========================
     FINAL UPDATE
  ======================== */

  await Customer.findByIdAndUpdate(customerId, {
    $set: {
      "analytics.totalOrders": totalOrders,
      "analytics.totalSpend": totalSpend,
      "analytics.avgOrderValue": avgOrderValue,

      "analytics.highestOrderValue": values.length
        ? Math.max(...values)
        : 0,
      "analytics.lowestOrderValue": values.length
        ? Math.min(...values)
        : 0,

      "analytics.processingOrders": processingOrders,
      "analytics.packedOrders": packedOrders,
      "analytics.pickedOrders": pickedOrders,
      "analytics.shippedOrders": shippedOrders,
      "analytics.outForDeliveryOrders": outForDeliveryOrders,
      "analytics.deliveredOrders": deliveredOrders,

      "analytics.cancelledOrders": cancelledOrders,
      "analytics.returnRequestedOrders": returnRequestedOrders,
      "analytics.exchangeRequestedOrders": exchangeRequestedOrders,
      "analytics.returnedOrders": returnedOrders,
      "analytics.refundedOrdersByFulfillment":
        refundedOrdersByFulfillment,
      "analytics.exchangedOrders": exchangedOrders,
      "analytics.rtoOrders": rtoOrders,
      "analytics.failedOrders": failedOrders,

      "analytics.codOrders": codOrders,
      "analytics.prepaidOrders": prepaidOrders,
      "analytics.exchangeOrders": exchangeOrders,

      "analytics.paymentPendingOrders": paymentPendingOrders,
      "analytics.paidOrders": paidOrders,
      "analytics.paymentFailedOrders": paymentFailedOrders,
      "analytics.refundPendingOrders": refundPendingOrders,
      "analytics.refundedOrders": refundedOrders,

      "analytics.confirmedOrders": confirmedOrders,
      "analytics.unconfirmedOrders": unconfirmedOrders,
      "analytics.confirmedByCustomerOrders":
        confirmedByCustomerOrders,
      "analytics.confirmedByAdminOrders": confirmedByAdminOrders,
      "analytics.confirmedByAutoOrders": confirmedByAutoOrders,

      "analytics.firstOrderAt": firstOrderAt,
      "analytics.lastOrderAt": lastOrderAt,

      "analytics.lastDeliveredAt": latestDateFromOrders(
        orders,
        "fulfillmentDates.deliveredAt"
      ),
      "analytics.lastCancelledAt": latestDateFromOrders(
        orders,
        "fulfillmentDates.cancelledAt"
      ),
      "analytics.lastReturnedAt": latestDateFromOrders(
        orders,
        "fulfillmentDates.returnedAt"
      ),
      "analytics.lastRtoAt": latestDateFromOrders(
        orders,
        "fulfillmentDates.rtoAt"
      ),

      "analytics.deliveryRate": deliveryRate,
      "analytics.cancellationRate": cancellationRate,
      "analytics.returnRate": returnRate,
      "analytics.rtoRate": rtoRate,
      "analytics.paymentSuccessRate": paymentSuccessRate,

      "analytics.customerType": customerType,
      "analytics.riskScore": riskScore,

      "analytics.lastAnalyticsSyncAt": new Date(),
    },
  });
};

/* =========================================================
   OPTIONAL: BULK SYNC (CRON / ADMIN USE)
========================================================= */

export const recalculateAllCustomersAnalytics = async () => {
  const customers = await Customer.find({}).select("_id").lean();

  for (const c of customers) {
    try {
      await recalculateCustomerAnalytics(c._id);
    } catch (err) {
      console.error("Analytics sync failed:", c._id, err.message);
    }
  }
};