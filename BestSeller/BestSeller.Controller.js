import mongoose from "mongoose";
import Bestseller from "../BestSeller/BestSeller.js";

const s = (v) => String(v ?? "").trim();
const isOid = (v) => mongoose.Types.ObjectId.isValid(String(v || "").trim());

// ✅ CREATE (idempotent)
export const createBestseller = async (req, res) => {
  try {
    const productId = s(req.body?.productId);
    if (!productId) return res.status(400).json({ message: "productId is required" });
    if (!isOid(productId)) return res.status(400).json({ message: "Invalid productId" });

    const existing = await Bestseller.findOne({ productId }).lean();
    if (existing) return res.status(200).json(existing);

    const last = await Bestseller.findOne().sort({ position: -1 }).select("position").lean();
    const position = Number(last?.position || 0) + 1;

    const created = await Bestseller.create({ productId, position });
    return res.status(201).json(created);
  } catch (err) {
    if (err?.code === 11000) {
      const productId = s(req.body?.productId);
      const existing = await Bestseller.findOne({ productId }).lean();
      return res.status(200).json(existing || { message: "Already exists" });
    }
    return res.status(500).json({ message: "Failed to create bestseller", error: err?.message });
  }
};

// ✅ READ: ordered list
export const getAllBestsellers = async (_req, res) => {
  try {
    const data = await Bestseller.find().sort({ position: 1, createdAt: -1 });
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch bestsellers", error: err?.message });
  }
};

// ✅ READ: ids only (ordered)
export const getAllBestsellerIds = async (_req, res) => {
  try {
    const docs = await Bestseller.find({}, { productId: 1, _id: 0 })
      .sort({ position: 1, createdAt: -1 })
      .lean();

    return res.status(200).json(docs.map((d) => String(d.productId)));
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch bestseller ids", error: err?.message });
  }
};

// ✅ REORDER: PUT /api/bestseller/order  body: { ids: ["..."] }
export const setBestsellerOrder = async (req, res) => {
  try {
    const idsRaw = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = idsRaw.map(s).filter(Boolean);

    if (!ids.length) return res.status(400).json({ message: "ids[] is required" });

    const clean = ids.filter(isOid);
    if (!clean.length) return res.status(400).json({ message: "No valid ids provided" });

    // fetch existing docs
    const existing = await Bestseller.find({ productId: { $in: clean } }, { productId: 1 }).lean();
    const existingSet = new Set(existing.map((d) => String(d.productId)));

    // order only those that exist
    const orderedExisting = clean.filter((id) => existingSet.has(String(id)));

    // bulk update (positions 1..n)
    const ops = orderedExisting.map((productId, i) => ({
      updateOne: {
        filter: { productId },
        update: { $set: { position: i + 1 } },
      },
    }));

    if (ops.length) await Bestseller.bulkWrite(ops, { ordered: false });

    // ✅ compact the rest (those not present in ids array) to the end
    const tail = await Bestseller.find(
      { productId: { $nin: orderedExisting } },
      { productId: 1 }
    )
      .sort({ position: 1, createdAt: 1 })
      .lean();

    if (tail.length) {
      const base = orderedExisting.length;
      const tailOps = tail.map((d, idx) => ({
        updateOne: {
          filter: { productId: d.productId },
          update: { $set: { position: base + idx + 1 } },
        },
      }));
      await Bestseller.bulkWrite(tailOps, { ordered: false });
    }

    return res.status(200).json({
      message: "Order saved",
      count: orderedExisting.length,
      ignored: clean.length - orderedExisting.length, // ids not found in DB
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to save order", error: err?.message });
  }
};

// READ: single by doc _id
export const getBestsellerById = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await Bestseller.findById(id);
    if (!doc) return res.status(404).json({ message: "Bestseller not found" });
    return res.status(200).json(doc);
  } catch (err) {
    return res.status(400).json({ message: "Invalid id", error: err?.message });
  }
};

// UPDATE: productId for doc _id
export const updateBestseller = async (req, res) => {
  try {
    const { id } = req.params;
    const productId = s(req.body?.productId);
    if (!productId) return res.status(400).json({ message: "productId is required" });
    if (!isOid(productId)) return res.status(400).json({ message: "Invalid productId" });

    const updated = await Bestseller.findByIdAndUpdate(
      id,
      { productId },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: "Bestseller not found" });
    return res.status(200).json(updated);
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "productId already exists in bestsellers" });
    }
    return res.status(500).json({ message: "Failed to update bestseller", error: err?.message });
  }
};

// DELETE: by doc _id
export const deleteBestseller = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Bestseller.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: "Bestseller not found" });

    // ✅ optional compact after delete
    const rest = await Bestseller.find({}, { productId: 1 }).sort({ position: 1 }).lean();
    const ops = rest.map((d, i) => ({
      updateOne: { filter: { productId: d.productId }, update: { $set: { position: i + 1 } } },
    }));
    if (ops.length) await Bestseller.bulkWrite(ops, { ordered: false });

    return res.status(200).json({ message: "Deleted", deleted });
  } catch (err) {
    return res.status(400).json({ message: "Invalid id", error: err?.message });
  }
};

// DELETE: by productId
export const deleteBestsellerByProductId = async (req, res) => {
  try {
    const productId = s(req.params?.productId);
    if (!productId) return res.status(400).json({ message: "productId is required" });
    if (!isOid(productId)) return res.status(400).json({ message: "Invalid productId" });

    const deleted = await Bestseller.findOneAndDelete({ productId });
    if (!deleted) return res.status(404).json({ message: "Bestseller not found for this productId" });

    // ✅ compact after delete
    const rest = await Bestseller.find({}, { productId: 1 }).sort({ position: 1 }).lean();
    const ops = rest.map((d, i) => ({
      updateOne: { filter: { productId: d.productId }, update: { $set: { position: i + 1 } } },
    }));
    if (ops.length) await Bestseller.bulkWrite(ops, { ordered: false });

    return res.status(200).json({ message: "Deleted", deleted });
  } catch (err) {
    return res.status(500).json({ message: "Failed to delete", error: err?.message });
  }
};
