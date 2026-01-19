import mongoose from "mongoose";
import Collection from "./Collection.js";
import slugify from "slugify";

/* ============================================================
   CREATE COLLECTION
   - UPDATED for products: [{ product, productCode }]
============================================================ */
export const createCollection = async (req, res) => {
  try {
    const payload = { ...req.body };

    payload.slug = slugify(payload.name, {
      lower: true,
      strict: true,
    });

    const exists = await Collection.findOne({ slug: payload.slug });
    if (exists)
      return res.status(400).json({ message: "Collection already exists" });

    // OPTIONAL: normalize incoming products if client sends old format [ObjectId]
    // Convert to [{ product: id, productCode: "" }] if needed
    if (Array.isArray(payload.products) && payload.products.length > 0) {
      payload.products = payload.products.map((p) => {
        // old format: ObjectId string
        if (
          typeof p === "string" ||
          mongoose.isValidObjectId(p) ||
          p instanceof mongoose.Types.ObjectId
        ) {
          return { product: p, productCode: "" }; // productCode required in schema; ideally send from client
        }

        // new format: { product, productCode }
        return {
          product: p.product,
          productCode: p.productCode,
        };
      });
    }

    const collection = await Collection.create(payload);
    res.status(201).json({ collection });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Create failed" });
  }
};

/* ============================================================
   GET ALL COLLECTIONS
   - UPDATED populate path: "products.product"
============================================================ */
export const getAllCollections = async (req, res) => {
  try {
    const collections = await Collection.find()
      .populate("products.product", "title price images productCode")
      .sort({ createdAt: -1 });

    res.json(collections);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Fetch failed" });
  }
};

/* ============================================================
   GET COLLECTION BY ID OR SLUG
   - UPDATED populate path: "products.product"
============================================================ */
export const getCollectionById = async (req, res) => {
  try {
    const { idOrSlug } = req.params;

    const query = mongoose.isValidObjectId(idOrSlug)
      ? { _id: idOrSlug }
      : { slug: idOrSlug };

    const collection = await Collection.findOne(query).populate(
      "products.product",
      "title price images productCode"
    );

    if (!collection)
      return res.status(404).json({ message: "Collection not found" });

    res.json(collection);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Fetch failed" });
  }
};

/* ============================================================
   UPDATE COLLECTION
   - UPDATED for products: [{ product, productCode }]
============================================================ */
export const updateCollection = async (req, res) => {
  try {
    const updates = { ...req.body };

    if (updates.name) {
      updates.slug = slugify(updates.name, {
        lower: true,
        strict: true,
      });
    }

    // OPTIONAL: normalize incoming products if client sends old format [ObjectId]
    if (Array.isArray(updates.products) && updates.products.length > 0) {
      updates.products = updates.products.map((p) => {
        // old format: ObjectId string
        if (
          typeof p === "string" ||
          mongoose.isValidObjectId(p) ||
          p instanceof mongoose.Types.ObjectId
        ) {
          return { product: p, productCode: "" }; // productCode required in schema; ideally send from client
        }

        // new format: { product, productCode }
        return {
          product: p.product,
          productCode: p.productCode,
        };
      });
    }

    const collection = await Collection.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );

    if (!collection)
      return res.status(404).json({ message: "Collection not found" });

    res.json({ collection });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Update failed" });
  }
};

/* ============================================================
   DELETE COLLECTION
============================================================ */
export const deleteCollection = async (req, res) => {
  try {
    const deleted = await Collection.findByIdAndDelete(req.params.id);
    if (!deleted)
      return res.status(404).json({ message: "Collection not found" });

    res.json({ message: "Collection deleted" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Delete failed" });
  }
};
