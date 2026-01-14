import mongoose from "mongoose";
import Collaboration from "./Collaboration.js";

/* ---------------------------
  Helpers
---------------------------- */
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const pickAllowedUpdates = (body = {}) => {
  const allowed = {};

  if (body.influencer) {
    allowed.influencer = {};
    if ("influencerId" in body.influencer)
      allowed.influencer.influencerId = body.influencer.influencerId || null;
    if ("name" in body.influencer) allowed.influencer.name = body.influencer.name;
    if ("state" in body.influencer) allowed.influencer.state = body.influencer.state;
    if ("address" in body.influencer) allowed.influencer.address = body.influencer.address;
    if ("links" in body.influencer) allowed.influencer.links = body.influencer.links;
  }

  if ("productId" in body) allowed.productId = body.productId;
  if ("platform" in body) allowed.platform = body.platform;
  if ("status" in body) allowed.status = body.status;
  if ("notes" in body) allowed.notes = body.notes;

  return allowed;
};

/* ---------------------------------------------------------------
  CREATE
  POST /api/collaborations
---------------------------------------------------------------- */
export const createCollaboration = async (req, res) => {
  try {
    const { influencer, productId, platform, status, notes } = req.body || {};

    if (!influencer?.name) {
      return res
        .status(400)
        .json({ success: false, message: "Influencer name is required" });
    }
    if (!productId || !isValidObjectId(productId)) {
      return res
        .status(400)
        .json({ success: false, message: "Valid productId is required" });
    }
    if (!platform) {
      return res
        .status(400)
        .json({ success: false, message: "platform is required" });
    }

    const doc = await Collaboration.create({
      influencer: {
        influencerId: influencer?.influencerId || null,
        name: influencer?.name,
        state: influencer?.state || "",
        address: influencer?.address || "",
        links: Array.isArray(influencer?.links) ? influencer.links : [],
      },
      productId,
      platform: String(platform).toLowerCase(),
      status: status || "ongoing",
      notes: notes || "",
    });

    return res.status(201).json({ success: true, data: doc });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "Ongoing collaboration already exists for same influencer + product + platform",
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ---------------------------------------------------------------
  READ (LIST with filters + pagination)
  GET /api/collaborations?status=ongoing&platform=instagram&productId=...&q=name&state=...
---------------------------------------------------------------- */
export const listCollaborations = async (req, res) => {
  try {
    const {
      status,
      platform,
      productId,
      state,
      q,
      page = 1,
      limit = 20,
      sort = "-createdAt",
    } = req.query;

    const filter = {};

    if (status) filter.status = status;
    if (platform) filter.platform = String(platform).toLowerCase();
    if (state) filter["influencer.state"] = String(state).trim();

    if (productId) {
      if (!isValidObjectId(productId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid productId" });
      }
      filter.productId = productId;
    }

    if (q) {
      filter["influencer.name"] = {
        $regex: String(q).trim(),
        $options: "i",
      };
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const [items, total] = await Promise.all([
      Collaboration.find(filter)
        .sort(sort)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate("productId", "title slug productCode price thumbnail"),
      Collaboration.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: items,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ---------------------------------------------------------------
  READ (SINGLE)
  GET /api/collaborations/:id
---------------------------------------------------------------- */
export const getCollaborationById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const doc = await Collaboration.findById(id).populate(
      "productId",
      "title slug productCode price thumbnail"
    );

    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "Collaboration not found" });
    }

    return res.json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ---------------------------------------------------------------
  UPDATE (PATCH)
  PATCH /api/collaborations/:id
---------------------------------------------------------------- */
export const updateCollaboration = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const updates = pickAllowedUpdates(req.body);

    if (updates.platform) updates.platform = String(updates.platform).toLowerCase();
    if (updates.productId && !isValidObjectId(updates.productId)) {
      return res.status(400).json({ success: false, message: "Invalid productId" });
    }

    if (updates.influencer && "name" in updates.influencer) {
      if (!updates.influencer.name) {
        return res
          .status(400)
          .json({ success: false, message: "Influencer name cannot be empty" });
      }
    }

    const doc = await Collaboration.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    }).populate("productId", "title slug productCode price thumbnail");

    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "Collaboration not found" });
    }

    return res.json({ success: true, data: doc });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "Ongoing collaboration already exists for same influencer + product + platform",
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};
