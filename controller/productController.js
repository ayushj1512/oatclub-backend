import Product from "../models/Products.js";
import Category from "../models/Category.js";
import Attribute from "../models/Attribute.js";
import slugify from "slugify";
import mongoose from "mongoose";
import { uploadToCloudinary } from "../config/cloudinary.js";
import { generateUniqueSKU } from "../utility/sku.js";

/* ---------------- tiny helpers ---------------- */
const arr = (v) =>
  !v ? [] : Array.isArray(v) ? v : typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : [];

const tagsNorm = (v) => arr(v).map((t) => String(t || "").trim().toLowerCase()).filter(Boolean);

const json = (v, fb) => {
  if (v == null) return fb;
  if (typeof v === "object") return v;
  if (typeof v !== "string") return fb;
  const s = v.trim();
  if (!s) return fb;
  try {
    return JSON.parse(s);
  } catch {
    return fb;
  }
};

const oid = (v) => (v && typeof v === "object" && v._id ? v._id : v);

const pop = (q) =>
  q
    .populate("category")
    .populate("collections")
    .populate("attributes.attribute")
    .populate("variants.attributes.attribute");

const uploadFile = async (file, folder = "products") => {
  if (!file) return null;
  const r = await uploadToCloudinary(file, folder);
  const url = r?.secure_url || r?.url || r?.data?.secure_url || r?.data?.url;
  if (!url) throw new Error("Cloudinary upload failed: URL missing");
  return url;
};

const extractSizeColor = (variant) => {
  const attrs = Array.isArray(variant?.attributes) ? variant.attributes : [];
  const pick = (key) => attrs.find((a) => String(a?.key || "").toLowerCase() === key)?.value || "";
  return { size: pick("size"), color: pick("color") };
};

const applyStockFromVariants = (doc) => {
  const p = doc?.toObject ? doc.toObject() : doc;
  if (!p) return p;

  const variants = Array.isArray(p.variants) ? p.variants : [];
  const isVariable = p.productType === "variable" || variants.length > 0;

  if (!isVariable) {
    const st = Number(p.stock ?? 0);
    return { ...p, stock: st, isInStock: Boolean(p.isInStock ?? (st > 0)) };
  }

  const total = variants.reduce((s, v) => s + Number(v?.stock ?? 0), 0);
  const any = variants.some((v) => Number(v?.stock ?? 0) > 0 && v?.isInStock !== false);
  return { ...p, stock: total, isInStock: any };
};

const ensureSKUs = async (data, categoryDoc) => {
  const categoryName = categoryDoc?.name || "CAT";
  const title = data.title || data.slug || "PRODUCT";
  const variants = Array.isArray(data.variants) ? data.variants : [];

  if (!variants.length) {
    if (!data.sku) {
      data.sku = await generateUniqueSKU(Product, { brand: "MIR", category: categoryName, title });
    }
    return data;
  }

  data.productType = "variable";
  delete data.sku;

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i] || {};
    if (v.sku) continue;
    const { size, color } = extractSizeColor(v);
    variants[i] = {
      ...v,
      sku: await generateUniqueSKU(Product, { brand: "MIR", category: categoryName, title, size, color }),
    };
  }

  data.variants = variants;
  return data;
};

const validateCategory = async (categoryId) => {
  if (!categoryId || !mongoose.Types.ObjectId.isValid(String(categoryId))) return null;
  return Category.findById(categoryId);
};

const validateAttributes = async (attributes = []) => {
  if (!Array.isArray(attributes) || !attributes.length) return;
  for (const a of attributes) {
    const id = oid(a?.attribute);
    if (!id) continue;
    const ok = await Attribute.exists({ _id: id });
    if (!ok) throw new Error(`Invalid attribute ID: ${id}`);
  }
};

const mergeUploads = async (req, existing = {}) => {
  const uploadedImages = [];
  let uploadedThumbnail = "";

  // multer .array("images")
  if (Array.isArray(req.files) && req.files.length) {
    for (const f of req.files) uploadedImages.push(await uploadFile(f, "products"));
  }

  // multer.fields(...)
  if (req.files && !Array.isArray(req.files)) {
    const imgs = Array.isArray(req.files.images) ? req.files.images : [];
    const thumbs = Array.isArray(req.files.thumbnail) ? req.files.thumbnail : [];

    for (const f of imgs) uploadedImages.push(await uploadFile(f, "products"));
    if (thumbs[0]) uploadedThumbnail = await uploadFile(thumbs[0], "products");
  }

  const keepImages = json(existing.keepImages, null);
  const bodyImages = json(existing.images, null);

  const base =
    Array.isArray(keepImages) ? keepImages :
    Array.isArray(bodyImages) ? bodyImages :
    Array.isArray(existing._existingImages) ? existing._existingImages : [];

  const images = [...arr(base), ...uploadedImages].filter(Boolean);
  const incomingThumb = typeof existing.thumbnail === "string" ? existing.thumbnail : "";
  const thumbnail = uploadedThumbnail || incomingThumb || existing._existingThumb || images[0] || "";

  return { images, thumbnail };
};

/* ============================================================
   CREATE
============================================================ */
export const createProduct = async (req, res) => {
  try {
    const data = { ...req.body };

    data.attributes = json(data.attributes, []);
    data.variants = json(data.variants, []);
    data.highlights = json(data.highlights, []);
    data.keywords = arr(data.keywords);
    data.tags = tagsNorm(data.tags);
    data.collections = arr(data.collections);
    if (data.subcategory === "" || data.subcategory === "null") data.subcategory = null;

    data.slug = slugify(String(data.slug || data.title || ""), { lower: true });
    if (await Product.exists({ slug: data.slug })) return res.status(400).json({ message: "Slug already exists" });

    const categoryDoc = await validateCategory(data.category);
    if (!categoryDoc) return res.status(400).json({ message: "Invalid category ID" });

    await validateAttributes(data.attributes);

    const { images, thumbnail } = await mergeUploads(req, { images: data.images, thumbnail: data.thumbnail });
    data.images = images;
    data.thumbnail = thumbnail;

    data.productType = Array.isArray(data.variants) && data.variants.length ? "variable" : data.productType || "simple";
    await ensureSKUs(data, categoryDoc);

    const created = await Product.create(data);
    const full = await pop(Product.findById(created._id));
    return res.status(201).json({ message: "Product created successfully", product: applyStockFromVariants(full) });
  } catch (e) {
    console.error("❌ Create Product Error:", e);
    return res.status(400).json({ message: e.message });
  }
};

/* ============================================================
   GET ALL
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
      sku,
    } = req.query;

    const filters = {};
    if (category) filters.category = category;
    if (subcategory) filters.subcategory = subcategory;
    if (collection) filters.collections = collection;

    const t = tagsNorm(tags);
    if (t.length) filters.tags = { $in: t };

    if (isActive !== undefined) filters.isActive = isActive === "true";

    if (sku) filters.$or = [{ sku: String(sku) }, { "variants.sku": String(sku) }];

    if (minPrice || maxPrice) {
      filters.price = {};
      if (minPrice) filters.price.$gte = Number(minPrice);
      if (maxPrice) filters.price.$lte = Number(maxPrice);
    }

    if (search) filters.$text = { $search: search };

    const sortMap = {
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      newest: { createdAt: -1 },
      rating: { averageRating: -1 },
      popularity: { "analytics.views": -1 },
    };

    const skip = (Number(page) - 1) * Number(limit);
    const sortObj = sortMap[sort] || { createdAt: -1 };

    const docs = await pop(Product.find(filters)).sort(sortObj).skip(skip).limit(Number(limit));
    const total = await Product.countDocuments(filters);

    res.json({
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      products: docs.map(applyStockFromVariants), // ✅ FIX variable stock here
    });
  } catch (e) {
    console.error("❌ Get All Products Error:", e);
    res.status(500).json({ message: e.message });
  }
};

/* ============================================================
   GET BY ID OR SLUG
============================================================ */
export const getProductByIdOrSlug = async (req, res) => {
  try {
    const param = req.params.id;

    let doc = await pop(Product.findOne({ slug: param }));
    if (!doc && mongoose.Types.ObjectId.isValid(String(param))) doc = await pop(Product.findById(param));

    if (!doc) return res.status(404).json({ message: "Product not found" });
    res.json(applyStockFromVariants(doc)); // ✅ FIX
  } catch (e) {
    console.error("❌ Get Product Error:", e);
    res.status(500).json({ message: e.message });
  }
};

/* ============================================================
   GET BY SKU
============================================================ */
export const getProductBySKU = async (req, res) => {
  try {
    const { sku } = req.params;

    const doc = await pop(
      Product.findOne({ $or: [{ sku }, { "variants.sku": sku }] })
    );
    if (!doc) return res.status(404).json({ message: "SKU not found" });

    const product = applyStockFromVariants(doc); // ✅ FIX
    const matchedVariant = product.variants?.find((v) => v.sku === sku) || null;

    res.json({ product, matchedVariant });
  } catch (e) {
    console.error("❌ Get By SKU Error:", e);
    res.status(500).json({ message: e.message });
  }
};

/* ============================================================
   UPDATE
============================================================ */
export const updateProduct = async (req, res) => {
  try {
    const data = { ...req.body };

    data.attributes = json(data.attributes, data.attributes);
    data.variants = json(data.variants, data.variants);
    data.highlights = json(data.highlights, data.highlights);

    if (data.keywords !== undefined) data.keywords = arr(data.keywords);
    if (data.tags !== undefined) data.tags = tagsNorm(data.tags);
    if (data.collections !== undefined) data.collections = arr(data.collections);
    if (data.subcategory === "" || data.subcategory === "null") data.subcategory = null;

    const existing = await Product.findById(req.params.id).populate("category");
    if (!existing) return res.status(404).json({ message: "Product not found" });

    // slug uniqueness
    if (data.slug || data.title) {
      const nextSlug = slugify(String(data.slug || data.title || existing.title), { lower: true });
      if (nextSlug !== existing.slug) {
        const clash = await Product.exists({ slug: nextSlug, _id: { $ne: existing._id } });
        if (clash) return res.status(400).json({ message: "Slug already exists" });
        data.slug = nextSlug;
      }
    }

    // category change
    let categoryDoc = existing.category;
    if (data.category && String(data.category) !== String(existing.category?._id || existing.category)) {
      categoryDoc = await validateCategory(data.category);
      if (!categoryDoc) return res.status(400).json({ message: "Invalid category ID" });
    }

    await validateAttributes(data.attributes);

    const { images, thumbnail } = await mergeUploads(req, {
      keepImages: data.keepImages,
      images: data.images,
      thumbnail: data.thumbnail,
      _existingImages: existing.images,
      _existingThumb: existing.thumbnail,
    });

    data.images = images;
    data.thumbnail = thumbnail;

    // productType decision
    if (Array.isArray(data.variants) && data.variants.length) {
      data.productType = "variable";
      delete data.sku;
    } else if (Array.isArray(data.variants) && data.variants.length === 0) {
      data.productType = "simple";
    }

    // ensure SKUs
    const skuData = { ...existing.toObject(), ...data };
    await ensureSKUs(skuData, categoryDoc);
    data.sku = skuData.sku;
    data.variants = skuData.variants;

    const updated = await pop(
      Product.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true })
    );

    if (!updated) return res.status(404).json({ message: "Product not found" });
    res.json({ message: "Product updated successfully", product: applyStockFromVariants(updated) }); // ✅ FIX
  } catch (e) {
    console.error("❌ Update Product Error:", e);
    res.status(500).json({ message: e.message });
  }
};

/* ============================================================
   DELETE / BULK / ANALYTICS / VARIANT STOCK / RATINGS / IMPORT
============================================================ */
export const deleteProduct = async (req, res) => {
  try {
    const deleted = await Product.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Product not found" });
    res.json({ message: "Product deleted successfully" });
  } catch (e) {
    console.error("❌ Delete Product Error:", e);
    res.status(500).json({ message: e.message });
  }
};

export const bulkDeleteProducts = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ message: "No IDs provided" });
    await Product.deleteMany({ _id: { $in: ids } });
    res.json({ message: "Products deleted successfully" });
  } catch (e) {
    console.error("❌ Bulk Delete Error:", e);
    res.status(500).json({ message: e.message });
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

    res.json(applyStockFromVariants(product)); // optional but fine
  } catch (e) {
    console.error("❌ Analytics Update Error:", e);
    res.status(500).json({ message: e.message });
  }
};

export const updateVariantStock = async (req, res) => {
  try {
    const { variantId, stock } = req.body;

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const variant = product.variants.id(variantId);
    if (!variant) return res.status(404).json({ message: "Variant not found" });

    variant.stock = Number(stock);
    variant.isInStock = Number(stock) > 0;

    await product.save();

    const full = await pop(Product.findById(product._id));
    res.json({ message: "Variant stock updated", product: applyStockFromVariants(full) }); // ✅ FIX
  } catch (e) {
    console.error("❌ Variant Stock Error:", e);
    res.status(500).json({ message: e.message });
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
  } catch (e) {
    console.error("❌ Ratings Error:", e);
    res.status(500).json({ message: e.message });
  }
};

export const bulkImportProducts = async (req, res) => {
  try {
    const { products } = req.body;
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: "No products received" });
    }

    const imported = [];
    const failed = [];

    for (let i = 0; i < products.length; i++) {
      const p = products[i];

      try {
        // ✅ runs schema hooks: productCode + SKU generation + productType
        const doc = await Product.create(p);
        imported.push(doc);
      } catch (e) {
        failed.push({
          index: i,
          slug: p?.slug || null,
          title: p?.title || null,
          wordpressId: p?.wordpressId ?? null,
          message: e?.message || String(e),
        });
      }
    }

    return res.json({
      message: "Bulk import completed",
      receivedCount: products.length,
      importedCount: imported.length,
      failedCount: failed.length,
      failed: failed.slice(0, 50), // keep response light
    });
  } catch (e) {
    console.error("❌ Bulk Import Error:", e);
    return res.status(500).json({ message: e.message });
  }
};

