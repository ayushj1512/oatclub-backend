// Razorpay/razorpayReports.controller.js

import { razorpay } from "./razorpay.instance.js";

/* =========================================================
   HELPERS
========================================================= */

const toUnix = (date) => Math.floor(new Date(date).getTime() / 1000);

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

/* =========================================================
   GET ALL TRANSACTIONS
   (Payments + receipt mapping)
========================================================= */

export const getAllTransactions = async (req, res) => {
  try {
    const {
      from,
      to,
      status,
      page = 1,
      limit = 20,
    } = req.query;

    const count = Number(limit);
    const skip = (Number(page) - 1) * count;

    /* -----------------------------
       Step 1: Fetch payments
    ----------------------------- */
    const paymentsRes = await razorpay.payments.all({
      count,
      skip,
      from: from ? toUnix(from) : undefined,
      to: to ? toUnix(to) : undefined,
    });

    let payments = paymentsRes.items || [];

    /* -----------------------------
       Step 2: Get orderIds
    ----------------------------- */
    const orderIds = [
      ...new Set(payments.map((p) => p.order_id).filter(Boolean)),
    ];

    /* -----------------------------
       Step 3: Fetch orders for receipt mapping
    ----------------------------- */
    const receiptMap = {};

    await Promise.all(
      orderIds.map(async (oid) => {
        try {
          const order = await razorpay.orders.fetch(oid);
          receiptMap[oid] = order.receipt;
        } catch {
          receiptMap[oid] = null;
        }
      })
    );

    /* -----------------------------
       Step 4: Format data
    ----------------------------- */
    let data = payments.map((p) => formatPayment(p, receiptMap));

    /* -----------------------------
       Step 5: Filter (status)
    ----------------------------- */
    if (status) {
      data = data.filter((d) => d.status === status);
    }

    return res.json({
      ok: true,
      page: Number(page),
      limit: count,
      count: data.length,
      data,
    });
  } catch (err) {
    console.error("❌ getAllTransactions error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

/* =========================================================
   GET TRANSACTION BY RECEIPT (ORDER NUMBER)
========================================================= */

export const getTransactionsByReceipt = async (req, res) => {
  try {
    const { receipt } = req.params;

    /* -----------------------------
       Step 1: Find order by receipt
    ----------------------------- */
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

    /* -----------------------------
       Step 2: Fetch payments
    ----------------------------- */
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
    res.status(500).json({ ok: false, error: err.message });
  }
};

/* =========================================================
   SUMMARY (DASHBOARD CARDS)
========================================================= */

export const getTransactionSummary = async (req, res) => {
  try {
    const paymentsRes = await razorpay.payments.all({ count: 100 });

    const payments = paymentsRes.items || [];

    let success = 0;
    let failed = 0;
    let pending = 0;
    let totalAmount = 0;

    payments.forEach((p) => {
      if (p.status === "captured") {
        success++;
        totalAmount += p.amount;
      } else if (p.status === "failed") {
        failed++;
      } else {
        pending++;
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
    res.status(500).json({ ok: false, error: err.message });
  }
};