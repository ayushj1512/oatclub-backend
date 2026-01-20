// BestSeller/BestSeller.jsx
// Controller (CRUD) for Bestseller model (MongoDB + Mongoose)

import Bestseller from "../BestSeller/Bestseller.js"; // <-- adjust path as per your structure

// CREATE: add a productId to bestseller list
export const createBestseller = async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ message: "productId is required" });
    }

    const created = await Bestseller.create({ productId });
    return res.status(201).json(created);
  } catch (err) {
    // Duplicate key error (unique productId)
    if (err?.code === 11000) {
      return res.status(409).json({ message: "productId already exists in bestsellers" });
    }
    return res.status(500).json({ message: "Failed to create bestseller", error: err?.message });
  }
};

// READ: get all bestseller documents
export const getAllBestsellers = async (_req, res) => {
  try {
    const data = await Bestseller.find().sort({ createdAt: -1 });
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch bestsellers", error: err?.message });
  }
};

// READ (special): get ONLY all product IDs
export const getAllBestsellerIds = async (_req, res) => {
  try {
    const docs = await Bestseller.find({}, { productId: 1, _id: 0 }).lean();
    const ids = docs.map((d) => String(d.productId));
    return res.status(200).json(ids);
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch bestseller ids", error: err?.message });
  }
};

// READ: get a single bestseller by Mongo _id
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

// UPDATE: update productId for a bestseller doc by _id
export const updateBestseller = async (req, res) => {
  try {
    const { id } = req.params;
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ message: "productId is required" });
    }

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

// DELETE: remove a bestseller doc by _id
export const deleteBestseller = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await Bestseller.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: "Bestseller not found" });

    return res.status(200).json({ message: "Deleted", deleted });
  } catch (err) {
    return res.status(400).json({ message: "Invalid id", error: err?.message });
  }
};

// DELETE (special): remove by productId (handy)
export const deleteBestsellerByProductId = async (req, res) => {
  try {
    const { productId } = req.params;

    const deleted = await Bestseller.findOneAndDelete({ productId });
    if (!deleted) return res.status(404).json({ message: "Bestseller not found for this productId" });

    return res.status(200).json({ message: "Deleted", deleted });
  } catch (err) {
    return res.status(400).json({ message: "Invalid productId", error: err?.message });
  }
};
