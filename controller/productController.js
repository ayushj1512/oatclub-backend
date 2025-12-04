import Product from "../models/Products.js";
import Category from "../models/Category.js";
import Attribute from "../models/Attribute.js";
import slugify from "slugify";
import mongoose from "mongoose";

import { uploadToCloudinary } from "../config/cloudinary.js";
import { generateSKU, generateUniqueSKU } from "../utility/sku.js"; // ✅ adjust path if needed

/* ---------------- NORMALIZERS ---------------- */
const normalizeArray = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") return val.split(",").map((v) => v.trim()).filter(Boolean);
  return [];
};

const parseMaybeJSON = (val, fallback) => {
  if (val == null) return fallback;
  if (typeof val === "object") return val;
  if (typeof val !== "string") return fallback;
  const t = val.trim();
  if (!t) return fallback;
  try {
    return JSON.parse(t);
  } catch {
    return fallback;
  }
};

const toObjectId = (v) => {
  if (!v) return null;
  if (typeof v === "object" && v._id) return v._id;
  return v;
};

/**
 * Extract size/color from variant.attributes array (your schema)
 */
const extractSizeColor = (variant) => {
  const attrs = Array.isArray(variant?.attributes) ? variant.attributes : [];
  const pick = (key) =>
    attrs.find((a) => String(a?.key || "").toLowerCase() === key)?.value || "";
  return { size: pick("size"), color: pick("color") };
};

/**
 * CLOUDINARY UPLOAD FIX:
 * - multer memory storage provides file.buffer
 * - your uploadToCloudinary should accept (fileOrBuffer, folder)
 * This wrapper ensures we always pass buffer + mimetype safely.
 */
const uploadFile = async (file, folder = "products") => {
  if (!file) return null;

  // If your helper already accepts multer file, keep it.
  // Otherwise many helpers expect buffer:
  const payload = file.buffer ? file : file; // keep as file, helper can read buffer
  const cloudRes = await uploadToCloudinary(payload, folder);

  // Support different helper return shapes
  const url =
    cloudRes?.secure_url ||
    cloudRes?.url ||
    cloudRes?.data?.secure_url ||
    cloudRes?.data?.url;

  if (!url) throw new Error("Cloudinary upload failed: URL missing");
  return url;
};

/* ============================================================
   SKU GENERATION (Server truth)
   - simple: product.sku
   - variable: variants[].sku each
   NOTE: at controller level we can use category name for better SKU.
============================================================ */
const ensureSKUs = async (data, categoryDoc) => {
  const categoryName = categoryDoc?.name || "CAT";
  const title = data.title || data.slug || "PRODUCT";

  // Decide variable
  const variants = Array.isArray(data.variants) ? data.variants : [];
  const isVariable = variants.length > 0;

  if (!isVariable) {
    // simple
    if (!data.sku) {
      // safest: ensure unique by hitting DB
      data.sku = await generateUniqueSKU(Product, {
        brand: "MIR",
        category: categoryName,
        title,
      });
    }
    return data;
  }

  // variable: do not rely on product.sku
  data.productType = "variable";
  if (data.sku) delete data.sku;

  // generate variant SKUs if missing
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i] || {};
    if (v.sku) continue;

    const { size, color } = extractSizeColor(v);
    // ensure unique on nested path (variants.sku)
    const sku = await generateUniqueSKU(Product, {
      brand: "MIR",
      category: categoryName,
      title,
      size,
      color,
    });

    variants[i] = { ...v, sku };
  }

  data.variants = variants;
  return data;
};

/* ============================================================
   📌 CREATE PRODUCT — With Cloudinary + SKU Generation
   Supports both JSON and multipart/form-data
============================================================ */
export const createProduct = async (req, res) => {
  try {
    let data = { ...req.body };

    // Parse JSON fields if passed as strings (common in form-data)
    data.attributes = parseMaybeJSON(data.attributes, data.attributes || []);
    data.variants = parseMaybeJSON(data.variants, data.variants || []);
    data.highlights = parseMaybeJSON(data.highlights, data.highlights || []);

    // Normalize arrays
    data.keywords = normalizeArray(data.keywords);
    data.tags = normalizeArray(data.tags);
    data.collections = normalizeArray(data.collections);

    // Clean optionals
    if (data.subcategory === "" || data.subcategory === "null") data.subcategory = null;

    /* ---------------- SLUG ---------------- */
    data.slug = data.slug
      ? slugify(String(data.slug), { lower: true })
      : slugify(String(data.title || ""), { lower: true });

    const existingSlug = await Product.findOne({ slug: data.slug });
    if (existingSlug) return res.status(400).json({ message: "Slug already exists" });

    /* ---------------- CATEGORY CHECK ---------------- */
    if (!data.category || !mongoose.Types.ObjectId.isValid(String(data.category))) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    const categoryExists = await Category.findById(data.category);
    if (!categoryExists) return res.status(400).json({ message: "Invalid category ID" });

    /* ---------------- VALIDATE ATTRIBUTES ---------------- */
    if (Array.isArray(data.attributes)) {
      for (const attr of data.attributes) {
        const attrId = toObjectId(attr?.attribute);
        if (!attrId) continue;
        const exists = await Attribute.findById(attrId);
        if (!exists) {
          return res.status(400).json({ message: `Invalid attribute ID: ${attrId}` });
        }
      }
    }

    /* ============================================================
       📸 UPLOAD IMAGES TO CLOUDINARY
       Expected:
       - req.files (array) OR
       - req.files.images (array) + req.files.thumbnail (array)
    ============================================================= */
    let uploadedImages = [];
    let uploadedThumbnail = "";

    // Case A: multer .array("images")
    if (Array.isArray(req.files) && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadFile(file, "products");
        uploadedImages.push(url);
      }
    }

    // Case B: multer.fields([{name:"images"},{name:"thumbnail"}])
    if (req.files && !Array.isArray(req.files)) {
      const imageFiles = Array.isArray(req.files.images) ? req.files.images : [];
      const thumbFiles = Array.isArray(req.files.thumbnail) ? req.files.thumbnail : [];

      for (const f of imageFiles) {
        const url = await uploadFile(f, "products");
        uploadedImages.push(url);
      }

      if (thumbFiles[0]) {
        uploadedThumbnail = await uploadFile(thumbFiles[0], "products");
      }
    }

    // Merge with any images coming from body (if admin sends existing URLs)
    const bodyImages = parseMaybeJSON(data.images, data.images || []);
    const mergedImages = [
      ...normalizeArray(bodyImages),
      ...uploadedImages,
    ].filter(Boolean);

    data.images = mergedImages;

    // thumbnail priority:
    // 1) uploaded thumbnail
    // 2) body thumbnail (existing)
    // 3) first image
    data.thumbnail =
      uploadedThumbnail ||
      (typeof data.thumbnail === "string" ? data.thumbnail : "") ||
      mergedImages[0] ||
      "";

    /* ============================================================
       VARIABLE PRODUCT CHECK + SKU Generation (server truth)
    ============================================================= */
    if (Array.isArray(data.variants) && data.variants.length > 0) {
      data.productType = "variable";
    } else {
      data.productType = data.productType || "simple";
    }

    await ensureSKUs(data, categoryExists);

    /* ---------------- CREATE PRODUCT ---------------- */
    const product = await Product.create(data);

    const populated = await Product.findById(product._id)
      .populate("category")
      .populate("collections")
      .populate("tags")
      .populate("attributes.attribute")
      .populate("variants.attributes.attribute");

    return res.status(201).json({
      message: "Product created successfully",
      product: populated,
    });
  } catch (err) {
    console.error("❌ Create Product Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ============================================================
   📌 GET ALL PRODUCTS
============================================================ */
export const getAllProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      subcategory,
      collection,
      tags,
      minPrice,
      maxPrice,
      isActive,
      search,
      sort,
      sku, // ✅ allow sku search
    } = req.query;

    const filters = {};

    if (category) filters.category = category;
    if (subcategory) filters.subcategory = subcategory;
    if (collection) filters.collections = collection;
    if (tags) filters.tags = { $in: normalizeArray(tags) };
    if (isActive !== undefined) filters.isActive = isActive === "true";

    if (sku) {
      filters.$or = [{ sku: String(sku) }, { "variants.sku": String(sku) }];
    }

    if (minPrice || maxPrice) {
      filters.price = {};
      if (minPrice) filters.price.$gte = Number(minPrice);
      if (maxPrice) filters.price.$lte = Number(maxPrice);
    }

    if (search) filters.$text = { $search: search };

    const sortOptions = {
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      newest: { createdAt: -1 },
      rating: { averageRating: -1 },
      popularity: { "analytics.views": -1 },
    };

    const sortObj = sortOptions[sort] || { createdAt: -1 };
    const skip = (Number(page) - 1) * Number(limit);

    const products = await Product.find(filters)
      .populate("category")
      .populate("collections")
      .populate("tags")
      .populate("attributes.attribute")
      .populate("variants.attributes.attribute")
      .sort(sortObj)
      .skip(skip)
      .limit(Number(limit));

    const total = await Product.countDocuments(filters);

    res.json({
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      products,
    });
  } catch (err) {
    console.error("❌ Get All Products Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ============================================================
   📌 GET PRODUCT BY ID / SLUG
============================================================ */
export const getProductByIdOrSlug = async (req, res) => {
  try {
    const param = req.params.id;

    const product =
      (await Product.findOne({ slug: param })
        .populate("category")
        .populate("collections")
        .populate("tags")
        .populate("attributes.attribute")
        .populate("variants.attributes.attribute")) ||
      (mongoose.Types.ObjectId.isValid(String(param))
        ? await Product.findById(param)
            .populate("category")
            .populate("collections")
            .populate("tags")
            .populate("attributes.attribute")
            .populate("variants.attributes.attribute")
        : null);

    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (err) {
    console.error("❌ Get Product Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ============================================================
   📌 GET PRODUCT BY SKU (Warehouse)
   GET /api/products/sku/:sku
============================================================ */
export const getProductBySKU = async (req, res) => {
  try {
    const { sku } = req.params;

    const product = await Product.findOne({
      $or: [{ sku }, { "variants.sku": sku }],
    })
      .populate("category")
      .populate("attributes.attribute")
      .populate("variants.attributes.attribute");

    if (!product) return res.status(404).json({ message: "SKU not found" });

    const matchedVariant = product.variants?.find((v) => v.sku === sku) || null;

    res.json({ product, matchedVariant });
  } catch (err) {
    console.error("❌ Get By SKU Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ============================================================
   📌 UPDATE PRODUCT — supports Cloudinary uploads + SKU fill
   - You can send:
     - keepImages (json array of existing urls) OR images (json array)
     - new files in req.files
============================================================ */
export const updateProduct = async (req, res) => {
  try {
    let data = { ...req.body };

    // Parse JSON fields (form-data safe)
    data.attributes = parseMaybeJSON(data.attributes, data.attributes);
    data.variants = parseMaybeJSON(data.variants, data.variants);
    data.highlights = parseMaybeJSON(data.highlights, data.highlights);

    // Normalize arrays
    if (data.keywords !== undefined) data.keywords = normalizeArray(data.keywords);
    if (data.tags !== undefined) data.tags = normalizeArray(data.tags);
    if (data.collections !== undefined) data.collections = normalizeArray(data.collections);

    // Clean
    if (data.subcategory === "" || data.subcategory === "null") data.subcategory = null;

    // Load existing
    const existing = await Product.findById(req.params.id).populate("category");
    if (!existing) return res.status(404).json({ message: "Product not found" });

    // If title/slug updated, maintain slug uniqueness
    if (data.slug || data.title) {
      const nextSlug = data.slug
        ? slugify(String(data.slug), { lower: true })
        : slugify(String(data.title || existing.title), { lower: true });

      if (nextSlug !== existing.slug) {
        const clash = await Product.findOne({ slug: nextSlug, _id: { $ne: existing._id } });
        if (clash) return res.status(400).json({ message: "Slug already exists" });
        data.slug = nextSlug;
      }
    }

    // Category check (if changed)
    let categoryDoc = existing.category;
    if (data.category && String(data.category) !== String(existing.category?._id || existing.category)) {
      if (!mongoose.Types.ObjectId.isValid(String(data.category))) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      const cat = await Category.findById(data.category);
      if (!cat) return res.status(400).json({ message: "Invalid category ID" });
      categoryDoc = cat;
    }

    /* ---------------- VALIDATE ATTRIBUTES ---------------- */
    if (Array.isArray(data.attributes)) {
      for (const attr of data.attributes) {
        const attrId = toObjectId(attr?.attribute);
        if (!attrId) continue;
        const existsAttr = await Attribute.findById(attrId);
        if (!existsAttr) return res.status(400).json({ message: `Invalid attribute ID: ${attrId}` });
      }
    }

    /* ---------------- CLOUDINARY: merge existing + new ---------------- */
    const keepImages = parseMaybeJSON(data.keepImages, null);
    const bodyImages = parseMaybeJSON(data.images, null);

    // Decide "base images" to keep
    const baseImages =
      Array.isArray(keepImages) ? keepImages :
      Array.isArray(bodyImages) ? bodyImages :
      Array.isArray(existing.images) ? existing.images : [];

    let uploadedImages = [];
    let uploadedThumbnail = "";

    if (Array.isArray(req.files) && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadFile(file, "products");
        uploadedImages.push(url);
      }
    }

    if (req.files && !Array.isArray(req.files)) {
      const imageFiles = Array.isArray(req.files.images) ? req.files.images : [];
      const thumbFiles = Array.isArray(req.files.thumbnail) ? req.files.thumbnail : [];

      for (const f of imageFiles) {
        const url = await uploadFile(f, "products");
        uploadedImages.push(url);
      }

      if (thumbFiles[0]) {
        uploadedThumbnail = await uploadFile(thumbFiles[0], "products");
      }
    }

    const mergedImages = [...normalizeArray(baseImages), ...uploadedImages].filter(Boolean);
    data.images = mergedImages;

    // Update thumbnail carefully
    const incomingThumb = typeof data.thumbnail === "string" ? data.thumbnail : "";
    data.thumbnail = uploadedThumbnail || incomingThumb || existing.thumbnail || mergedImages[0] || "";

    /* ---------------- productType ---------------- */
    if (Array.isArray(data.variants) && data.variants.length > 0) {
      data.productType = "variable";
      if (data.sku) delete data.sku; // avoid confusion for variable
    } else if (data.variants && Array.isArray(data.variants) && data.variants.length === 0) {
      data.productType = "simple";
    }

    // Apply SKU generation if needed (server truth)
    const skuData = { ...existing.toObject(), ...data };
    await ensureSKUs(skuData, categoryDoc);

    // Only set sku/variants from skuData when we actually want to update them
    data.sku = skuData.sku;
    data.variants = skuData.variants;

    const updated = await Product.findByIdAndUpdate(req.params.id, data, {
      new: true,
      runValidators: true,
    })
      .populate("category")
      .populate("collections")
      .populate("tags")
      .populate("attributes.attribute")
      .populate("variants.attributes.attribute");

    if (!updated) return res.status(404).json({ message: "Product not found" });

    res.json({ message: "Product updated successfully", product: updated });
  } catch (err) {
    console.error("❌ Update Product Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ============================================================
   DELETE / BULK DELETE / RATINGS / VARIANT STOCK
============================================================ */
export const deleteProduct = async (req, res) => {
  try {
    const deleted = await Product.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Product not found" });
    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    console.error("❌ Delete Product Error:", err);
    res.status(500).json({ message: err.message });
  }
};

export const bulkDeleteProducts = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ message: "No IDs provided" });

    await Product.deleteMany({ _id: { $in: ids } });
    res.json({ message: "Products deleted successfully" });
  } catch (err) {
    console.error("❌ Bulk Delete Error:", err);
    res.status(500).json({ message: err.message });
  }
};

export const incrementProductAnalytics = async (req, res) => {
  try {
    const { type } = req.body;

    const valid = ["views", "purchases", "wishlistCount", "cartAdds", "searchAppearances"];
    if (!valid.includes(type)) return res.status(400).json({ message: "Invalid analytics type" });

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $inc: { [`analytics.${type}`]: 1 } },
      { new: true }
    );

    res.json(product);
  } catch (err) {
    console.error("❌ Analytics Update Error:", err);
    res.status(500).json({ message: err.message });
  }
};

export const updateVariantStock = async (req, res) => {
  try {
    const { variantId, stock } = req.body;

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const variant = product.variants.id(variantId);
    if (!variant) return res.status(404).json({ message: "Variant not found" });

    variant.stock = stock;
    variant.isInStock = stock > 0;

    await product.save();

    res.json({ message: "Variant stock updated", product });
  } catch (err) {
    console.error("❌ Variant Stock Error:", err);
    res.status(500).json({ message: err.message });
  }
};

export const updateProductRatings = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    await product.updateRatings();

    res.json({
      message: "Ratings updated",
      averageRating: product.averageRating,
      totalReviews: product.totalReviews,
    });
  } catch (err) {
    console.error("❌ Ratings Error:", err);
    res.status(500).json({ message: err.message });
  }
};

export const bulkImportProducts = async (req, res) => {
  try {
    const { products } = req.body;
    if (!products?.length) return res.status(400).json({ message: "No products received" });

    // Optional: ensure slugs + SKUs should be generated at import time too (recommended)
    const imported = await Product.insertMany(products, { ordered: false });

    res.json({
      message: "Products imported successfully",
      importedCount: imported.length,
    });
  } catch (err) {
    console.error("❌ Bulk Import Error:", err);
    res.status(500).json({ message: err.message });
  }
};
