// Razorpay/razorpayReports.controller.js

import { razorpay } from "./razorpay.instance.js";

/* =========================================================
   HELPERS
========================================================= */

const toUnix = (date, endOfDay = false) => {
  if (!date) return undefined;
  const d = new Date(date);
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
};

const formatPayment = (p, receiptMap = {}) => ({
  paymentId: p.id,
  orderId: p.order_id,
  receipt: receiptMap[p.order_id] || null,
  amount: p.amount / 100,
  currency: p.currency,
  status: p.status,
  method: p.method,
  email: p.email,
  contact: p.contact,
  fee: p.fee ? p.fee / 100 : 0,
  tax: p.tax ? p.tax / 100 : 0,
  createdAt: new Date(p.created_at * 1000),
});

const fetchAllPayments = async ({ from, to } = {}) => {
  const all = [];
  let skip = 0;
  const count = 100;

  while (true) {
    const res = await razorpay.payments.all({
      count,
      skip,
      from: from ? toUnix(from, false) : undefined,
      to: to ? toUnix(to, true) : undefined,
    });

    const items = res?.items || [];
    all.push(...items);

    if (items.length < count) break;
    skip += count;
  }

  return all;
};

const applyStatusFilter = (payments = [], status = "") => {
  if (!status) return payments;
  return payments.filter(
    (p) => String(p.status || "").toLowerCase() === String(status).toLowerCase()
  );
};

/* =========================================================
   GET ALL TRANSACTIONS
========================================================= */

export const getAllTransactions = async (req, res) => {
  try {
    const { from, to, status, page = 1, limit = 20 } = req.query;

    const currentPage = Math.max(1, Number(page || 1));
    const perPage = Math.max(1, Number(limit || 20));

    let payments = await fetchAllPayments({ from, to });
    payments = applyStatusFilter(payments, status);

    const total = payments.length;
    const start = (currentPage - 1) * perPage;
    const pagedPayments = payments.slice(start, start + perPage);

    const orderIds = [...new Set(pagedPayments.map((p) => p.order_id).filter(Boolean))];
    const receiptMap = {};

    await Promise.all(
      orderIds.map(async (oid) => {
        try {
          const order = await razorpay.orders.fetch(oid);
          receiptMap[oid] = order?.receipt || null;
        } catch {
          receiptMap[oid] = null;
        }
      })
    );

    const data = pagedPayments.map((p) => formatPayment(p, receiptMap));

    return res.json({
      ok: true,
      page: currentPage,
      limit: perPage,
      count: total,
      pages: Math.ceil(total / perPage),
      data,
    });
  } catch (err) {
    console.error("❌ getAllTransactions error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch transactions",
    });
  }
};

/* =========================================================
   GET TRANSACTION BY RECEIPT
========================================================= */

export const getTransactionsByReceipt = async (req, res) => {
  try {
    const { receipt } = req.params;

    const ordersRes = await razorpay.orders.all({
      receipt,
      count: 1,
    });

    const order = ordersRes.items?.[0];

    if (!order) {
      return res.status(404).json({
        ok: false,
        message: "Order not found for this receipt",
      });
    }

    const paymentsRes = await razorpay.orders.fetchPayments(order.id);
    const payments = paymentsRes.items || [];

    const data = payments.map((p) => ({
      paymentId: p.id,
      orderId: order.id,
      receipt,
      amount: p.amount / 100,
      status: p.status,
      method: p.method,
      email: p.email,
      contact: p.contact,
      createdAt: new Date(p.created_at * 1000),
    }));

    return res.json({
      ok: true,
      order,
      count: data.length,
      payments: data,
    });
  } catch (err) {
    console.error("❌ getTransactionsByReceipt error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch receipt details",
    });
  }
};

/* =========================================================
   SUMMARY
========================================================= */

export const getTransactionSummary = async (req, res) => {
  try {
    const { from, to, status } = req.query;

    let payments = await fetchAllPayments({ from, to });
    payments = applyStatusFilter(payments, status);

    let success = 0;
    let failed = 0;
    let pending = 0;
    let totalAmount = 0;

    payments.forEach((p) => {
      const s = String(p.status || "").toLowerCase();

      if (s === "captured") {
        success += 1;
        totalAmount += Number(p.amount || 0);
      } else if (s === "failed") {
        failed += 1;
      } else {
        pending += 1;
      }
    });

    return res.json({
      ok: true,
      summary: {
        success,
        failed,
        pending,
        totalAmount: totalAmount / 100,
      },
    });
  } catch (err) {
    console.error("❌ getTransactionSummary error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch summary",
    });
  }
};