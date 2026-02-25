import MarketingSpend from "./marketingSpend.js";

const toDate = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ✅ POST /api/marketing/spend
export const createMarketingSpend = async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    const source = String(req.body?.source || "").trim();
    const currency = String(req.body?.currency || "INR").trim();
    const notes = String(req.body?.notes || "").trim();

    // allow date string "YYYY-MM-DD" from frontend
    const spentAt = toDate(req.body?.spentAt || req.body?.date || new Date());

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }
    if (!source || source.length < 2) {
      return res.status(400).json({ success: false, message: "Source is required" });
    }
    if (!spentAt) {
      return res.status(400).json({ success: false, message: "Invalid spent date" });
    }

    const doc = await MarketingSpend.create({
      amount,
      source,
      currency,
      notes,
      spentAt,
      createdBy: req.user?._id || null, // if auth middleware sets req.user
    });

    return res.status(201).json({ success: true, data: doc });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Server error",
    });
  }
};

// ✅ GET /api/marketing/spend?source=Meta%20Ads&from=2026-02-01&to=2026-02-29&page=1&limit=20
export const listMarketingSpend = async (req, res) => {
  try {
    const source = String(req.query?.source || "").trim();
    const from = req.query?.from ? toDate(req.query.from) : null;
    const to = req.query?.to ? toDate(req.query.to) : null;

    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 20)));
    const skip = (page - 1) * limit;

    const q = {};
    if (source) q.source = source;
    if (from || to) {
      q.spentAt = {};
      if (from) q.spentAt.$gte = from;
      if (to) q.spentAt.$lte = to;
    }

    const [items, total] = await Promise.all([
      MarketingSpend.find(q).sort({ spentAt: -1, _id: -1 }).skip(skip).limit(limit),
      MarketingSpend.countDocuments(q),
    ]);

    return res.json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

// ✅ GET /api/marketing/spend/summary?month=2026-02
// returns total + source-wise totals for that month
export const marketingSpendSummary = async (req, res) => {
  try {
    const month = String(req.query?.month || "").trim(); // "YYYY-MM"
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: "month is required in YYYY-MM format",
      });
    }

    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(y, m, 1, 0, 0, 0)); // next month start

    const rows = await MarketingSpend.aggregate([
      { $match: { spentAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: "$source",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]);

    const grandTotal = rows.reduce((a, r) => a + (r.total || 0), 0);

    return res.json({
      success: true,
      month,
      grandTotal,
      bySource: rows.map((r) => ({
        source: r._id,
        total: r.total,
        count: r.count,
      })),
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

// ✅ DELETE /api/marketing/spend/:id
export const deleteMarketingSpend = async (req, res) => {
  try {
    const id = req.params?.id;
    const doc = await MarketingSpend.findByIdAndDelete(id);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Spend not found" });
    }
    return res.json({ success: true, message: "Deleted", data: doc });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};