import MarketingSpend from "./marketingSpend.js";

const IST = "Asia/Kolkata";

/**
 * Parse "YYYY-MM-DD" into a Date representing that day's start in IST (as an absolute UTC timestamp).
 * Example: 2026-03-01 IST 00:00 => 2026-02-28T18:30:00.000Z
 */
const startOfDayIST = (ymd) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return null;
  const [y, m, d] = String(ymd).split("-").map(Number);

  // Create a UTC date corresponding to IST midnight:
  // IST = UTC+5:30 => subtract 5:30 from IST time to get UTC timestamp
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
};

/**
 * End of day IST (exclusive next day's start)
 */
const nextDayStartIST = (ymd) => {
  const s = startOfDayIST(ymd);
  if (!s) return null;
  return new Date(s.getTime() + 24 * 60 * 60 * 1000);
};

const toDate = (v) => {
  if (!v) return null;

  // If frontend sends "YYYY-MM-DD", handle as IST day range safely
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return startOfDayIST(s);
  }

  // Otherwise normal Date parsing (ISO timestamps etc.)
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

    // allow date string "YYYY-MM-DD" from frontend (interpreted as IST start of that day)
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
      createdBy: req.user?._id || null,
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
    const fromRaw = req.query?.from ? String(req.query.from).trim() : "";
    const toRaw = req.query?.to ? String(req.query.to).trim() : "";

    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 20))); // allow a bit more for infinite scroll
    const skip = (page - 1) * limit;

    const q = {};
    if (source) q.source = source;

    // ✅ IST-safe date filtering
    // if from/to are YYYY-MM-DD => use [fromStartIST, nextDayStartIST(to)) with $lt (exclusive)
    const fromIsYMD = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw);
    const toIsYMD = /^\d{4}-\d{2}-\d{2}$/.test(toRaw);

    let from = null;
    let toExclusive = null;

    if (fromRaw) {
      from = fromIsYMD ? startOfDayIST(fromRaw) : toDate(fromRaw);
      if (!from) {
        return res.status(400).json({ success: false, message: "Invalid from date" });
      }
    }

    if (toRaw) {
      if (toIsYMD) {
        toExclusive = nextDayStartIST(toRaw);
      } else {
        const toParsed = toDate(toRaw);
        if (!toParsed) {
          return res.status(400).json({ success: false, message: "Invalid to date" });
        }
        // For timestamp inputs, make it inclusive by adding 1ms? Better keep as exclusive by +1ms is messy.
        // We'll treat it as inclusive with $lte for non-YMD timestamp case.
        toExclusive = null;
        q.spentAt = q.spentAt || {};
        q.spentAt.$lte = toParsed;
      }
    }

    if (from || toExclusive) {
      q.spentAt = q.spentAt || {};
      if (from) q.spentAt.$gte = from;
      if (toExclusive) q.spentAt.$lt = toExclusive; // ✅ correct for full "to" day
    }

    const [items, total] = await Promise.all([
      MarketingSpend.find(q)
        .sort({ spentAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit),
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
        hasMore: skip + items.length < total,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

// ✅ GET /api/marketing/spend/summary?month=2026-02
// returns total + source-wise totals for that month (IST month boundaries)
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

    // ✅ Month boundaries in IST:
    // start = YYYY-MM-01 IST 00:00
    // end = next month YYYY-(MM+1)-01 IST 00:00
    const startYMD = `${y}-${String(m).padStart(2, "0")}-01`;
    const endMonth = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
    const endYMD = `${endMonth.y}-${String(endMonth.m).padStart(2, "0")}-01`;

    const start = startOfDayIST(startYMD);
    const end = startOfDayIST(endYMD);

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
      tz: IST,
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