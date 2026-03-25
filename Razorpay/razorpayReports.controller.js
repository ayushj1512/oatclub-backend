// Razorpay/razorpayReports.controller.js

import axios from "axios";
import { razorpay } from "./razorpay.instance.js";

/* =========================================================
   HELPERS
========================================================= */

const toUnix = (date, endOfDay = false) => {
  if (!date) return undefined;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
};

const money = (v) => Number((Number(v || 0) / 100).toFixed(2));
const num = (v) => Number(v || 0);
const normalizeText = (v) => String(v || "").trim().toLowerCase();

const formatDate = (unix) =>
  unix
    ? new Date(unix * 1000).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
      })
    : "—";

const formatPayment = (p, receiptMap = {}) => ({
  paymentId: p.id,
  orderId: p.order_id || "",
  receipt: receiptMap[p.order_id] || null,
  amount: money(p.amount),
  currency: p.currency || "INR",
  status: p.status || "",
  method: p.method || "",
  email: p.email || "",
  contact: p.contact || "",
  fee: money(p.fee),
  tax: money(p.tax),
  createdAt: p.created_at || null,
  createdAtLabel: formatDate(p.created_at),
});

const formatSettlement = (s) => ({
  settlementId: s.id,
  amount: money(s.amount),
  status: s.status || "",
  utr: s.utr || "",
  fee: money(s.fees),
  tax: money(s.tax),
  createdAt: s.created_at || null,
  createdAtLabel: formatDate(s.created_at),
  settledAt: s.settled_at || null,
  settledAtLabel: formatDate(s.settled_at),
});

const fetchAllPayments = async ({ from, to } = {}) => {
  const all = [];
  let skip = 0;
  const count = 100;

  while (true) {
    const res = await razorpay.payments.all({
      count,
      skip,
      from: toUnix(from),
      to: toUnix(to, true),
    });

    const items = res?.items || [];
    all.push(...items);

    if (items.length < count) break;
    skip += count;
  }

  return all;
};

const fetchAllSettlements = async ({ from, to, limit = 100, skip = 0 } = {}) => {
  return await razorpay.settlements.all({
    count: limit,
    skip,
    from: toUnix(from),
    to: toUnix(to, true),
  });
};

const applyStatusFilter = (items = [], status = "") => {
  if (!status) return items;
  const s = normalizeText(status);
  return items.filter((x) => normalizeText(x.status) === s);
};

const fetchSettlementReconApi = async ({ year, month, day } = {}) => {
  const { data } = await axios.get(
    "https://api.razorpay.com/v1/settlements/recon/combined",
    {
      auth: {
        username: process.env.RAZORPAY_KEY_ID,
        password: process.env.RAZORPAY_KEY_SECRET,
      },
      params: {
        year,
        month,
        ...(day ? { day } : {}),
      },
    }
  );

  return Array.isArray(data?.items) ? data.items : [];
};

/* =========================================================
   TRANSACTIONS
========================================================= */

export const getAllTransactions = async (req, res) => {
  try {
    const { from, to, status, page = 1, limit = 20 } = req.query;

    const currentPage = Math.max(1, Number(page));
    const perPage = Math.max(1, Number(limit));

    let payments = await fetchAllPayments({ from, to });
    payments = applyStatusFilter(payments, status);

    const total = payments.length;
    const start = (currentPage - 1) * perPage;
    const pagedPayments = payments.slice(start, start + perPage);

    const orderIds = [...new Set(pagedPayments.map((p) => p.order_id).filter(Boolean))];
    const receiptMap = {};

    await Promise.all(
      orderIds.map(async (orderId) => {
        try {
          const order = await razorpay.orders.fetch(orderId);
          receiptMap[orderId] = order?.receipt || null;
        } catch {
          receiptMap[orderId] = null;
        }
      })
    );

    return res.json({
      ok: true,
      page: currentPage,
      limit: perPage,
      count: total,
      pages: Math.ceil(total / perPage),
      data: pagedPayments.map((p) => formatPayment(p, receiptMap)),
    });
  } catch (err) {
    console.error("getAllTransactions error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch transactions",
    });
  }
};

export const getTransactionsByReceipt = async (req, res) => {
  try {
    const receipt = String(req.params.receipt || "").trim();

    if (!receipt) {
      return res.status(400).json({ ok: false, error: "Receipt is required" });
    }

    const ordersRes = await razorpay.orders.all({ receipt, count: 1 });
    const order = ordersRes?.items?.[0];

    if (!order) {
      return res.status(404).json({
        ok: false,
        message: "Order not found for this receipt",
      });
    }

    const paymentsRes = await razorpay.orders.fetchPayments(order.id);
    const payments = paymentsRes?.items || [];

    return res.json({
      ok: true,
      count: payments.length,
      payments: payments.map((p) => ({
        paymentId: p.id,
        orderId: order.id,
        receipt,
        amount: money(p.amount),
        currency: p.currency || "INR",
        status: p.status || "",
        method: p.method || "",
        email: p.email || "",
        contact: p.contact || "",
        fee: money(p.fee),
        tax: money(p.tax),
        createdAt: p.created_at || null,
        createdAtLabel: formatDate(p.created_at),
      })),
    });
  } catch (err) {
    console.error("getTransactionsByReceipt error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch receipt details",
    });
  }
};

export const getTransactionSummary = async (req, res) => {
  try {
    const { from, to, status } = req.query;

    let payments = await fetchAllPayments({ from, to });
    payments = applyStatusFilter(payments, status);

    const summary = payments.reduce(
      (acc, p) => {
        const s = normalizeText(p.status);

        acc.totalCount += 1;

        if (s === "captured") {
          acc.success += 1;
          acc.totalAmount += num(p.amount);
        } else if (s === "failed") {
          acc.failed += 1;
        } else {
          acc.pending += 1;
        }

        return acc;
      },
      { totalCount: 0, success: 0, failed: 0, pending: 0, totalAmount: 0 }
    );

    return res.json({
      ok: true,
      summary: {
        totalCount: summary.totalCount,
        success: summary.success,
        failed: summary.failed,
        pending: summary.pending,
        totalAmount: money(summary.totalAmount),
      },
    });
  } catch (err) {
    console.error("getTransactionSummary error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch summary",
    });
  }
};

/* =========================================================
   SETTLEMENTS
========================================================= */

export const getAllSettlements = async (req, res) => {
  try {
    const { from, to, page = 1, limit = 20 } = req.query;

    const currentPage = Math.max(1, Number(page));
    const perPage = Math.max(1, Number(limit));
    const skip = (currentPage - 1) * perPage;

    const response = await fetchAllSettlements({
      from,
      to,
      limit: perPage,
      skip,
    });

    const items = response?.items || [];

    return res.json({
      ok: true,
      page: currentPage,
      limit: perPage,
      count: items.length,
      data: items.map(formatSettlement),
    });
  } catch (err) {
    console.error("getAllSettlements error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch settlements",
    });
  }
};

export const getSettlementById = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ ok: false, error: "Settlement id is required" });
    }

    const settlement = await razorpay.settlements.fetch(id);

    return res.json({
      ok: true,
      data: formatSettlement(settlement),
    });
  } catch (err) {
    console.error("getSettlementById error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch settlement",
    });
  }
};

export const getSettlementRecon = async (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const day = req.query.day ? Number(req.query.day) : undefined;

    if (!year || !month) {
      return res.status(400).json({
        ok: false,
        error: "year and month are required",
      });
    }

    const items = await fetchSettlementReconApi({ year, month, day });

    return res.json({
      ok: true,
      year,
      month,
      day: day || null,
      count: items.length,
      data: items,
    });
  } catch (err) {
    console.error("getSettlementRecon error:", err?.response?.data || err);
    return res.status(500).json({
      ok: false,
      error: err?.response?.data?.error?.description || err.message || "Failed to fetch settlement recon",
    });
  }
};

export const getRemittanceReport = async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year || now.getFullYear());
    const month = Number(req.query.month || now.getMonth() + 1);
    const day = req.query.day ? Number(req.query.day) : undefined;

    const receipt = String(req.query.receipt || "").trim();
    const method = normalizeText(req.query.method);
    const type = normalizeText(req.query.type);
    const settlementId = String(req.query.settlementId || "").trim();

    let items = await fetchSettlementReconApi({ year, month, day });

    if (receipt) {
      items = items.filter((x) => normalizeText(x.order_receipt) === normalizeText(receipt));
    }

    if (method) {
      items = items.filter((x) => normalizeText(x.method) === method);
    }

    if (type) {
      items = items.filter((x) => normalizeText(x.type) === type);
    }

    if (settlementId) {
      items = items.filter((x) => String(x.settlement_id || "").trim() === settlementId);
    }

    const data = items.map((x, index) => {
      const amount = num(x.amount);
      const fee = num(x.fee ?? x.fees);
      const tax = num(x.tax);
      const net = amount - fee - tax;

      return {
        srNo: index + 1,
        settlementId: x.settlement_id || "",
        orderReceipt: x.order_receipt || "",
        orderId: x.order_id || "",
        paymentId: x.payment_id || "",
        refundId: x.refund_id || "",
        method: x.method || "",
        type: x.type || "",
        description: x.description || "",
        amount: money(amount),
        fee: money(fee),
        tax: money(tax),
        net: money(net),
        debit: money(x.debit),
        credit: money(x.credit),
        settledAt: x.settled_at || null,
        settledAtLabel: x.settled_at
          ? new Date(x.settled_at).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
            })
          : "—",
      };
    });

    const summary = data.reduce(
      (acc, row) => {
        acc.totalRows += 1;
        acc.totalAmount += num(row.amount);
        acc.totalFee += num(row.fee);
        acc.totalTax += num(row.tax);
        acc.totalNet += num(row.net);
        return acc;
      },
      { totalRows: 0, totalAmount: 0, totalFee: 0, totalTax: 0, totalNet: 0 }
    );

    return res.json({
      ok: true,
      filters: {
        year,
        month,
        day: day || null,
        receipt: receipt || "",
        method: method || "",
        type: type || "",
        settlementId: settlementId || "",
      },
      summary: {
        totalRows: summary.totalRows,
        totalAmount: Number(summary.totalAmount.toFixed(2)),
        totalFee: Number(summary.totalFee.toFixed(2)),
        totalTax: Number(summary.totalTax.toFixed(2)),
        totalNet: Number(summary.totalNet.toFixed(2)),
      },
      data,
    });
  } catch (err) {
    console.error("getRemittanceReport error:", err?.response?.data || err);
    return res.status(500).json({
      ok: false,
      error: err?.response?.data?.error?.description || err.message || "Failed to fetch remittance report",
    });
  }
};