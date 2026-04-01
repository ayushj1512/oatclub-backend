import mongoose from "mongoose";
import InfluencerProgram from "./InfluencerProgram.js";

const safeNum = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const cleanText = (value) => String(value ?? "").trim();

const normalizeDigits = (value) =>
  String(value ?? "").replace(/\D/g, "");

const buildPlatform = (data = {}) => ({
  url: cleanText(data.url),
  followers: safeNum(data.followers, 0),
  avgViews: safeNum(data.avgViews, 0),
  engagementRate: safeNum(data.engagementRate, 0),
});

const buildPayload = (body = {}) => ({
  fullName: cleanText(body.fullName),
  email: cleanText(body.email).toLowerCase(),
  mobile: cleanText(body.mobile),
  city: cleanText(body.city),
  state: cleanText(body.state),

  socials: {
    instagram: buildPlatform(body.socials?.instagram),
    facebook: buildPlatform(body.socials?.facebook),
    snapchat: buildPlatform(body.socials?.snapchat),
    youtube: buildPlatform(body.socials?.youtube),
    other: buildPlatform(body.socials?.other),
  },

  collaborationType: cleanText(body.collaborationType) || "barter",
  status: cleanText(body.status) || "new",
  source: cleanText(body.source),
  niche: cleanText(body.niche),
  notes: cleanText(body.notes),
});

const buildSearchFilter = (search = "") => {
  const q = cleanText(search);
  if (!q) return {};

  const digits = normalizeDigits(q);
  const or = [
    { code: { $regex: q, $options: "i" } },
    { fullName: { $regex: q, $options: "i" } },
    { mobile: { $regex: q, $options: "i" } },
  ];

  if (digits) {
    or.push({ code: digits.padStart(6, "0") });
    or.push({ mobile: { $regex: digits, $options: "i" } });
  }

  return { $or: or };
};

/* =========================
   CREATE
========================= */
export const createInfluencer = async (req, res) => {
  try {
    const payload = buildPayload(req.body);

    if (!payload.fullName) {
      return res.status(400).json({
        ok: false,
        message: "Full name is required",
      });
    }

    const influencer = await InfluencerProgram.create(payload);

    return res.status(201).json({
      ok: true,
      message: "Influencer created successfully",
      influencer,
    });
  } catch (error) {
    console.error("createInfluencer error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to create influencer",
      error: error.message,
    });
  }
};

/* =========================
   GET ALL
========================= */
export const getAllInfluencers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = "",
      status,
      collaborationType,
      city,
      state,
      niche,
      sort = "newest",
    } = req.query;

    const pageNum = Math.max(1, safeNum(page, 1));
    const limitNum = Math.max(1, Math.min(200, safeNum(limit, 20)));
    const skip = (pageNum - 1) * limitNum;

    const filters = {
      ...buildSearchFilter(search),
    };

    if (cleanText(status)) filters.status = cleanText(status);
    if (cleanText(collaborationType)) {
      filters.collaborationType = cleanText(collaborationType);
    }
    if (cleanText(city)) {
      filters.city = { $regex: cleanText(city), $options: "i" };
    }
    if (cleanText(state)) {
      filters.state = { $regex: cleanText(state), $options: "i" };
    }
    if (cleanText(niche)) {
      filters.niche = { $regex: cleanText(niche), $options: "i" };
    }

    let sortOption = { createdAt: -1 };

    if (sort === "oldest") sortOption = { createdAt: 1 };
    if (sort === "name_asc") sortOption = { fullName: 1 };
    if (sort === "name_desc") sortOption = { fullName: -1 };
    if (sort === "reach_desc") sortOption = { totalReach: -1 };
    if (sort === "reach_asc") sortOption = { totalReach: 1 };
    if (sort === "code_asc") sortOption = { code: 1 };
    if (sort === "code_desc") sortOption = { code: -1 };

    const [items, total] = await Promise.all([
      InfluencerProgram.find(filters)
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      InfluencerProgram.countDocuments(filters),
    ]);

    return res.status(200).json({
      ok: true,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      influencers: items,
    });
  } catch (error) {
    console.error("getAllInfluencers error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch influencers",
      error: error.message,
    });
  }
};

/* =========================
   GET ONE
========================= */
export const getInfluencerById = async (req, res) => {
  try {
    const { id } = req.params;

    const influencer = await InfluencerProgram.findById(id).lean();

    if (!influencer) {
      return res.status(404).json({
        ok: false,
        message: "Influencer not found",
      });
    }

    return res.status(200).json({
      ok: true,
      influencer,
    });
  } catch (error) {
    console.error("getInfluencerById error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch influencer",
      error: error.message,
    });
  }
};

/* =========================
   GET BY CODE
========================= */
export const getInfluencerByCode = async (req, res) => {
  try {
    const rawCode = cleanText(req.params.code);
    const code = normalizeDigits(rawCode).padStart(6, "0");

    const influencer = await InfluencerProgram.findOne({ code }).lean();

    if (!influencer) {
      return res.status(404).json({
        ok: false,
        message: "Influencer not found",
      });
    }

    return res.status(200).json({
      ok: true,
      influencer,
    });
  } catch (error) {
    console.error("getInfluencerByCode error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch influencer by code",
      error: error.message,
    });
  }
};

/* =========================
   UPDATE
========================= */
export const updateInfluencer = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = buildPayload(req.body);

    if (!payload.fullName) {
      return res.status(400).json({
        ok: false,
        message: "Full name is required",
      });
    }

    const influencer = await InfluencerProgram.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });

    if (!influencer) {
      return res.status(404).json({
        ok: false,
        message: "Influencer not found",
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Influencer updated successfully",
      influencer,
    });
  } catch (error) {
    console.error("updateInfluencer error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to update influencer",
      error: error.message,
    });
  }
};

/* =========================
   DELETE
========================= */
export const deleteInfluencer = async (req, res) => {
  try {
    const { id } = req.params;

    const influencer = await InfluencerProgram.findByIdAndDelete(id);

    if (!influencer) {
      return res.status(404).json({
        ok: false,
        message: "Influencer not found",
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Influencer deleted successfully",
    });
  } catch (error) {
    console.error("deleteInfluencer error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to delete influencer",
      error: error.message,
    });
  }
};

/* =========================
   STATUS UPDATE
========================= */
export const updateInfluencerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const status = cleanText(req.body.status);

    if (!status) {
      return res.status(400).json({
        ok: false,
        message: "Status is required",
      });
    }

    const influencer = await InfluencerProgram.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    );

    if (!influencer) {
      return res.status(404).json({
        ok: false,
        message: "Influencer not found",
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Status updated successfully",
      influencer,
    });
  } catch (error) {
    console.error("updateInfluencerStatus error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to update status",
      error: error.message,
    });
  }
};