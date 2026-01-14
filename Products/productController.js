// controller/productController.js

import Product from "./Products.js";
import Attribute from "../Attribute/Attribute.js";
import slugify from "slugify";
import mongoose from "mongoose";
import { uploadToCloudinary } from "../config/cloudinary.js";
import { generateUniqueSKU } from "../utility/sku.js";
import { generateVariants } from "../utility/variants.js";
import Category from "../Category/Category.js";

/* ---------------- tiny helpers ---------------- */
const arr = (v) =>
  !v
    ? []
    : Array.isArray(v)
      ? v
      : typeof v === "string"
        ? v
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : [];
const VARIANT_KEYS = ["size", "color"];
const tagsNorm = (v) =>
  arr(v)
    .map((t) => String(t || "").trim().toLowerCase())
    .filter(Boolean);

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

const pop = (q) => {
  return q
    .populate("collections")
    .populate("attributes.attribute")
    .populate({
      path: "crossSellProducts",
      select: "title slug price compareAtPrice thumbnail isActive",
      match: { isActive: true },
    });
};

   

const uploadFile = async (file, folder = "products") => {
  if (!file) return null;
  const r = await uploadToCloudinary(file, folder);
  const url = r?.secure_url || r?.url || r?.data?.secure_url || r?.data?.url;
  if (!url) throw new Error("Cloudinary upload failed: URL missing");
  return url;
};

const extractVariantKeys = (variant) => {
  const attrs = Array.isArray(variant?.attributes) ? variant.attributes : [];
  const pick = (key) =>
    attrs.find((a) => String(a?.key || "").toLowerCase() === key)?.value || "";
  return { size: pick("size"), color: pick("color") };
};



const applyStockFromVariants = (doc) => {
  const p = doc?.toObject ? doc.toObject() : doc;
  if (!p) return p;

  const variants = Array.isArray(p.variants) ? p.variants : [];
  const isVariable = p.productType === "variable" || variants.length > 0;

  if (!isVariable) {
    const st = Number(p.stock ?? 0);
    const inStock = st > 0;
    return {
      ...p,
      stock: st,
      isInStock: inStock,
      // ✅ auto-unpublish representation
      isActive: inStock ? p.isActive : false,
    };
  }

  const total = variants.reduce((s, v) => s + Number(v?.stock ?? 0), 0);
  const any = variants.some((v) => Number(v?.stock ?? 0) > 0);

  return {
    ...p,
    stock: total,
    isInStock: any,
    isActive: any ? p.isActive : false, // ✅ if none in stock -> unpublish
  };
};


const ensureSKUs = async (data) => {
  if (!data || typeof data !== "object") return data;

  /* ---------------- derive SKU context ---------------- */
  const categoryName =
    Array.isArray(data.categories) && data.categories.length
      ? String(data.categories[0]).toUpperCase()
      : "CAT";

  const title =
    String(data.title || data.slug || "PRODUCT").toUpperCase();

  const variants = Array.isArray(data.variants) ? data.variants : [];

  /* =====================================================
     SIMPLE PRODUCT
  ===================================================== */
  if (!variants.length) {
    data.productType = "simple";

    // keep existing SKU if already present
    if (!data.sku) {
      data.sku = await generateUniqueSKU(Product, {
        brand: "MIR",
        category: categoryName,
        title,
      });
    }

    return data;
  }

  /* =====================================================
     VARIABLE PRODUCT
  ===================================================== */
  data.productType = "variable";

  // ❗ simple SKU must NOT exist for variable products
  if (data.sku) delete data.sku;

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    if (!v || v.sku) continue;

    const { size, color } = extractVariantKeys(v);

    variants[i] = {
      ...v,
      sku: await generateUniqueSKU(Product, {
        brand: "MIR",
        category: categoryName,
        title,
        size: size || undefined,
        color: color || undefined,
      }),
    };
  }

  data.variants = variants;
  return data;
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

  if (Array.isArray(req.files) && req.files.length) {
    for (const f of req.files)
      uploadedImages.push(await uploadFile(f, "products"));
  }

  if (req.files && !Array.isArray(req.files)) {
    const imgs = Array.isArray(req.files.images) ? req.files.images : [];
    const thumbs = Array.isArray(req.files.thumbnail) ? req.files.thumbnail : [];

    for (const f of imgs) uploadedImages.push(await uploadFile(f, "products"));
    if (thumbs[0]) uploadedThumbnail = await uploadFile(thumbs[0], "products");
  }

  const keepImages = json(existing.keepImages, null);
  const bodyImages = json(existing.images, null);

  const base = Array.isArray(keepImages)
    ? keepImages
    : Array.isArray(bodyImages)
      ? bodyImages
      : Array.isArray(existing._existingImages)
        ? existing._existingImages
        : [];

  const images = [...arr(base), ...uploadedImages].filter(Boolean);
  const incomingThumb = typeof existing.thumbnail === "string" ? existing.thumbnail : "";
  const thumbnail =
    uploadedThumbnail || incomingThumb || existing._existingThumb || images[0] || "";

  return { images, thumbnail };
};

/* ============================================================
   ✅ NEW: GET PRODUCTS BY TAG(S)
   GET /api/products/by-tag?tag=sale
   GET /api/products/by-tag?tags=sale,new-arrival
   (supports same filters: category/subcategory/collection/minPrice/maxPrice/isActive/search/sort/page/limit/sku)
============================================================ */
export const getProductsByTag = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      tag,
      tags,          // comma-separated
      category,      // comma-separated category slugs/names
      collection,
      minPrice,
      maxPrice,
      isActive,
      search,
      sort,
      sku,
    } = req.query;

    /* ---------------- tags ---------------- */
    const t = tagsNorm(tags ?? tag);
    if (!t.length) {
      return res.status(400).json({ message: "tag/tags is required" });
    }

    const filters = { tags: { $in: t } };

    /* ---------------- categories (STRING ARRAY) ---------------- */
    if (category) {
      const cats = Array.isArray(category)
        ? category
        : String(category)
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);

      if (cats.length) {
        filters.categories = { $in: cats };
      }
    }

    /* ---------------- collections ---------------- */
    if (collection) {
      filters.collections = collection;
    }

    /* ---------------- active ---------------- */
    if (isActive !== undefined) {
      filters.isActive = isActive === "true";
    }

    /* ---------------- SKU ---------------- */
    if (sku) {
      filters.$or = [
        { sku: String(sku) },
        { "variants.sku": String(sku) },
      ];
    }

    /* ---------------- price ---------------- */
    if (minPrice || maxPrice) {
      filters.price = {};
      if (minPrice) filters.price.$gte = Number(minPrice);
      if (maxPrice) filters.price.$lte = Number(maxPrice);
    }

    /* ---------------- search ---------------- */
    if (search) {
      filters.$text = { $search: search };
    }

    /* ---------------- sorting ---------------- */
    const sortMap = {
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      newest: { createdAt: -1 },
      rating: { averageRating: -1 },
      popularity: { "analytics.views": -1 },
    };

    const safeLimit = Math.min(200, Math.max(1, Number(limit)));
    const skip = (Number(page) - 1) * safeLimit;
    const sortObj = sortMap[sort] || { createdAt: -1 };

    /* ---------------- query ---------------- */
    const docs = await pop(Product.find(filters))
      .sort(sortObj)
      .skip(skip)
      .limit(safeLimit);

    const total = await Product.countDocuments(filters);

    return res.json({
      tags: t,
      total,
      page: Number(page),
      pages: Math.ceil(total / safeLimit),
      products: (docs || []).map(applyStockFromVariants),
    });
  } catch (e) {
    console.error("❌ Get Products By Tag Error:", e);
    return res.status(500).json({ message: e.message });
  }
};


/* helpers already in your file */
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

export const createProduct = async (req, res) => {
  try {
    const data = { ...req.body };

    /* =====================================================
       BULK MODE FLAG
    ===================================================== */
    const isBulk = data.importSource === "bulk";

    /* ---------------- normalize inputs ---------------- */
    data.attributes = json(data.attributes, []);
    data.highlights = json(data.highlights, []);
    data.keywords = arr(data.keywords);
    data.tags = tagsNorm(data.tags);
    data.collections = arr(data.collections);

    // ✅ NEW: patternNumber + fabrics + avgFabricConsumption
    if (data.patternNumber !== undefined)
      data.patternNumber = String(data.patternNumber || "").trim();

    data.fabrics = json(data.fabrics, []);
    data.avgFabricConsumption = json(
      data.avgFabricConsumption,
      data.avgFabricConsumption
    );

    /* ---------------- slug ---------------- */
    data.slug = slugify(String(data.slug || data.title || ""), { lower: true });

    if (await Product.exists({ slug: data.slug })) {
      return res.status(400).json({ message: "Slug already exists" });
    }

    /* ---------------- categories ---------------- */
    data.categories = Array.isArray(data.categories)
      ? data.categories
      : typeof data.categories === "string"
      ? data.categories.split(",").map((c) => c.trim()).filter(Boolean)
      : [];

    if (!data.categories.length) {
      return res.status(400).json({ message: "At least one category is required" });
    }

    /* =====================================================
       BULK PRODUCTS → FORCE SIMPLE + NO VARIANTS
    ===================================================== */
    if (isBulk) {
      data.attributes = [];
      data.variants = [];
      data.productType = "simple";

      // ✅ optional: keep fabrics/pattern in bulk if provided (no change)
      // If you want to clear them in bulk, uncomment:
      // data.fabrics = [];
      // data.avgFabricConsumption = { value: 0, unit: "meter" };
      // data.patternNumber = "";
    } else {
      /* ---------------- attribute validation ---------------- */
      await validateAttributes(data.attributes);

      // safety: strip variant image if any incoming
      if (Array.isArray(data.variants)) {
        data.variants = data.variants.map(({ image, ...v }) => v);
      }

      /* ---------------- auto-generate variants ---------------- */
      data.variants = generateVariants({
        productAttributes: data.attributes,
        existingVariants: [],
        variantKeys: VARIANT_KEYS,
      });

      data.productType = data.variants.length > 0 ? "variable" : "simple";
    }

    /* =====================================================
       CROSS-SELL PRODUCTS
    ===================================================== */
    data.crossSellProducts = Array.isArray(data.crossSellProducts)
      ? data.crossSellProducts
      : typeof data.crossSellProducts === "string"
      ? data.crossSellProducts.split(",").map((id) => id.trim())
      : [];

    data.crossSellProducts = data.crossSellProducts.filter(isValidObjectId);

    /* =====================================================
       MEDIA HANDLING
    ===================================================== */
    const { images, thumbnail } = await mergeUploads(req, {
      images: data.images,
      thumbnail: data.thumbnail,
    });

    data.images = images;
    data.thumbnail = thumbnail;

    /* ❗ Images REQUIRED only for NON-bulk products */
    if (!isBulk && (!data.images || !data.images.length)) {
      return res.status(400).json({ message: "At least one product image is required" });
    }

    /* =====================================================
       BULK FLAGS (VERY IMPORTANT)
    ===================================================== */
    if (isBulk) {
      data.images = [];
      data.thumbnail = "";
      data.isDraft = true;
      data.isActive = false;
    }

    /* ---------------- SKU handling ---------------- */
    await ensureSKUs(data);

    /* ---------------- create ---------------- */
    const created = await Product.create(data);

    /* prevent self cross-sell (safety net) */
    await Product.updateOne(
      { _id: created._id },
      { $pull: { crossSellProducts: created._id } }
    );

    const full = await pop(Product.findById(created._id));

    return res.status(201).json({
      message: isBulk ? "Bulk draft product created" : "Product created successfully",
      product: applyStockFromVariants(full),
    });
  } catch (e) {
    console.error("❌ Create Product Error:", e);
    return res.status(400).json({ message: e.message });
  }
};




/* ============================================================
   ✅ GET ALL (supports category/subcategory = slug OR id)
============================================================ */
export const getAllProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,      // comma-separated category strings
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

    /* ---------------- categories (STRING ARRAY) ---------------- */
    if (category) {
      const cats = Array.isArray(category)
        ? category
        : String(category)
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);

      if (cats.length) {
        filters.categories = { $in: cats };
      }
    }

    /* ---------------- collections ---------------- */
    if (collection) {
      filters.collections = collection;
    }

    /* ---------------- tags ---------------- */
    const t = tagsNorm(tags);
    if (t.length) {
      filters.tags = { $in: t };
    }

    /* ---------------- active ---------------- */
    if (isActive !== undefined) {
      filters.isActive = isActive === "true";
    }

    /* ---------------- SKU ---------------- */
    if (sku) {
      filters.$or = [
        { sku: String(sku) },
        { "variants.sku": String(sku) },
      ];
    }

    /* ---------------- price ---------------- */
    if (minPrice || maxPrice) {
      filters.price = {};
      if (minPrice) filters.price.$gte = Number(minPrice);
      if (maxPrice) filters.price.$lte = Number(maxPrice);
    }

    /* ---------------- search ---------------- */
    if (search) {
      filters.$text = { $search: search };
    }

    /* ---------------- sorting ---------------- */
    const sortMap = {
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      newest: { createdAt: -1 },
      rating: { averageRating: -1 },
      popularity: { "analytics.views": -1 },
    };

    const safeLimit = Math.min(200, Math.max(1, Number(limit)));
    const skip = (Number(page) - 1) * safeLimit;
    const sortObj = sortMap[sort] || { createdAt: -1 };

    /* ---------------- query ---------------- */
    const docs = await pop(Product.find(filters))
      .sort(sortObj)
      .skip(skip)
      .limit(safeLimit);

    const total = await Product.countDocuments(filters);

    return res.json({
      total,
      page: Number(page),
      pages: Math.ceil(total / safeLimit),
      products: docs.map(applyStockFromVariants),
    });
  } catch (e) {
    console.error("❌ Get All Products Error:", e);
    return res.status(500).json({ message: e.message });
  }
};


/* ============================================================
   GET BY ID OR SLUG
============================================================ */
export const getProductByIdOrSlug = async (req, res) => {
  try {
    const param = req.params.id;

    const query = Product.findOne({ slug: param }).populate({
      path: "crossSellProducts",
      select: "title slug price compareAtPrice thumbnail isActive",
      match: { isActive: true },
    });

    let doc = await pop(query);

    if (!doc && mongoose.Types.ObjectId.isValid(String(param))) {
      doc = await pop(
        Product.findById(param).populate({
          path: "crossSellProducts",
          select: "title slug price compareAtPrice thumbnail isActive",
          match: { isActive: true },
        })
      );
    }

    if (!doc) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(applyStockFromVariants(doc));
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
      Product.findOne({
        $or: [{ sku }, { "variants.sku": sku }],
      }).populate({
        path: "crossSellProducts",
        select: "title slug price compareAtPrice thumbnail isActive",
        match: { isActive: true },
      })
    );

    if (!doc) {
      return res.status(404).json({ message: "SKU not found" });
    }

    const product = applyStockFromVariants(doc);

    const matchedVariant =
      product.variants?.find((v) => v.sku === sku) || null;

    res.json({
      product,
      matchedVariant,
    });
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

    /* ---------------- normalize inputs ---------------- */
    data.attributes = json(data.attributes, data.attributes);
    data.highlights = json(data.highlights, data.highlights);

    if (data.keywords !== undefined) data.keywords = arr(data.keywords);
    if (data.tags !== undefined) data.tags = tagsNorm(data.tags);
    if (data.collections !== undefined) data.collections = arr(data.collections);

    // ✅ patternNumber + fabrics + avgFabricConsumption
    if (data.patternNumber !== undefined)
      data.patternNumber = String(data.patternNumber || "").trim();

    if (data.fabrics !== undefined) data.fabrics = json(data.fabrics, data.fabrics);

    if (data.avgFabricConsumption !== undefined)
      data.avgFabricConsumption = json(
        data.avgFabricConsumption,
        data.avgFabricConsumption
      );

    /* ---------------- fetch existing ---------------- */
    const existing = await Product.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Product not found" });
    }

    /* ---------------- slug ---------------- */
    if (data.slug || data.title) {
      const nextSlug = slugify(
        String(data.slug || data.title || existing.title),
        { lower: true }
      );

      if (nextSlug !== existing.slug) {
        const clash = await Product.exists({
          slug: nextSlug,
          _id: { $ne: existing._id },
        });
        if (clash) {
          return res.status(400).json({ message: "Slug already exists" });
        }
        data.slug = nextSlug;
      }
    }

    /* ---------------- categories ---------------- */
    if (data.categories !== undefined) {
      data.categories = Array.isArray(data.categories)
        ? data.categories
        : typeof data.categories === "string"
        ? data.categories.split(",").map((c) => c.trim()).filter(Boolean)
        : [];

      if (!data.categories.length) {
        return res.status(400).json({
          message: "At least one category is required",
        });
      }
    }

    /* ---------------- attribute validation ---------------- */
    await validateAttributes(data.attributes);

    // If someone sends variant "image", strip it (your variant schema has no images)
    if (Array.isArray(data.variants)) {
      data.variants = data.variants.map(({ image, ...v }) => v);
    }

    /* =========================================================
       ✅ STOCK REMOVAL (IMPORTANT)
       - disallow updating product.stock and variants.stock here
       - disallow isInStock updates here (model hooks compute it)
    ========================================================= */
    if (data.stock !== undefined) delete data.stock;
    if (data.isInStock !== undefined) delete data.isInStock;

    /* ---------------- VARIANTS ---------------- */
    if (Array.isArray(data.variants)) {
      data.variants = data.variants.map((v) => ({
        ...(v._id ? { _id: v._id } : {}),
        sku: v.sku,
        barcode: v.barcode ?? "",
        weight: typeof v.weight === "number" ? v.weight : 0,
        // ❌ stock removed
        // ❌ isInStock removed
        attributes: Array.isArray(v.attributes) ? v.attributes : [],
      }));
    } else {
      // if not sent, do not touch variants
      delete data.variants;
    }

    /* ---------------- product type ---------------- */
    if (Array.isArray(data.variants)) {
      data.productType = data.variants.length > 0 ? "variable" : "simple";
    }

    /* ------------------------------------------------------------------
       ✅ CROSS-SELL PRODUCTS
    ------------------------------------------------------------------- */
    if (data.crossSellProducts !== undefined) {
      data.crossSellProducts = Array.isArray(data.crossSellProducts)
        ? data.crossSellProducts
        : typeof data.crossSellProducts === "string"
        ? data.crossSellProducts.split(",").map((id) => id.trim())
        : [];

      data.crossSellProducts = data.crossSellProducts.filter(isValidObjectId);

      data.crossSellProducts = data.crossSellProducts.filter(
        (id) => String(id) !== String(existing._id)
      );
    }

    /* ---------------- uploads ---------------- */
    const { images, thumbnail } = await mergeUploads(req, {
      keepImages: data.keepImages,
      images: data.images,
      thumbnail: data.thumbnail,
      _existingImages: existing.images,
      _existingThumb: existing.thumbnail,
    });

    data.images = images;
    data.thumbnail = thumbnail;

    if (data.keepImages !== undefined) delete data.keepImages;

    /* ---------------- SKU handling ---------------- */
    const skuData = {
      ...existing.toObject(),
      ...data,
      variants: Array.isArray(data.variants) ? data.variants : existing.variants,
    };

    await ensureSKUs(skuData);

    data.sku = skuData.sku;
    if (Array.isArray(data.variants)) data.variants = skuData.variants;

    /* ---------------- apply changes & save ---------------- */
    existing.set(data);

    // help mongoose track nested replacements/changes
    if (Array.isArray(data.variants)) existing.markModified("variants");
    if (data.attributes !== undefined) existing.markModified("attributes");
    if (data.fabrics !== undefined) existing.markModified("fabrics");
    if (data.avgFabricConsumption !== undefined)
      existing.markModified("avgFabricConsumption");
    if (data.images !== undefined) existing.markModified("images");

    // ✅ IMPORTANT: don't use pop() here
    const saved = await existing.save({ validateBeforeSave: true });

    // ✅ If you need population similar to pop(), do it on the document:
    // (adjust these populate paths to match what pop() used in your project)
    const updated = await saved.populate([
      { path: "collections" },
      { path: "offer" },
      { path: "couponsApplicable" },
      { path: "reviews" },
      { path: "crossSellProducts" },
      // If you populate attributes.attribute:
      { path: "attributes.attribute" },
      { path: "variants.attributes.attribute" },
    ]);

    res.json({
      message: "Product updated successfully",
      product: applyStockFromVariants(updated),
    });
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

    res.json(applyStockFromVariants(product));
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
    res.json({
      message: "Variant stock updated",
      product: applyStockFromVariants(full),
    });
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
      failed: failed.slice(0, 50),
    });
  } catch (e) {
    console.error("❌ Bulk Import Error:", e);
    return res.status(500).json({ message: e.message });
  }
};

export const bulkUpdatePricing = async (req, res) => {
  try {
    const { updates = [] } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ message: "No updates provided" });
    }

    const ops = updates.map((u) => ({
      updateOne: {
        filter: { _id: u._id },
        update: {
          ...(u.price !== undefined ? { price: Number(u.price) } : {}),
          ...(u.compareAtPrice !== undefined
            ? { compareAtPrice: u.compareAtPrice === "" ? null : Number(u.compareAtPrice) }
            : {}),
        },
      },
    }));

    const result = await Product.bulkWrite(ops);

    return res.json({
      message: "Pricing updated successfully",
      modifiedCount: result.modifiedCount || 0,
    });
  } catch (e) {
    console.error("❌ Bulk Pricing Update Error:", e);
    return res.status(500).json({ message: e.message });
  }
};

/* ============================================================
   ✅ GET PRODUCTS BY CATEGORY (slug OR id OR name)
   GET /api/products/by-category/:category
   Example:
   /api/products/by-category/mens-shirts
============================================================ */
export const getProductsByCategory = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      collection,
      tags,
      minPrice,
      maxPrice,
      isActive,
      search,
      sort,
      sku,
    } = req.query;

    const categoryParam = req.params.category;

    if (!categoryParam) {
      return res.status(400).json({ message: "Category is required" });
    }

    /* ---------------------------------------------------------
       ✅ Find category by slug OR _id OR name
    --------------------------------------------------------- */
    let catDoc = null;

    if (mongoose.Types.ObjectId.isValid(categoryParam)) {
      catDoc = await Category.findById(categoryParam);
    }

    if (!catDoc) {
      catDoc = await Category.findOne({
        $or: [
          { slug: categoryParam.toLowerCase() },
          { name: categoryParam },
        ],
      });
    }

    /* ---------------------------------------------------------
       ✅ If category exists → match both slug + name
       ✅ else fallback → match raw param as string in Product.categories
    --------------------------------------------------------- */
    const categoryMatch = catDoc
      ? [catDoc.slug, catDoc.name]
      : [categoryParam];

    const filters = {
      categories: { $in: categoryMatch },
    };

    /* ---------------- collections ---------------- */
    if (collection) {
      filters.collections = collection;
    }

    /* ---------------- tags ---------------- */
    const t = tagsNorm(tags);
    if (t.length) {
      filters.tags = { $in: t };
    }

    /* ---------------- active ---------------- */
    if (isActive !== undefined) {
      filters.isActive = isActive === "true";
    }

    /* ---------------- SKU ---------------- */
    if (sku) {
      filters.$or = [
        { sku: String(sku) },
        { "variants.sku": String(sku) },
      ];
    }

    /* ---------------- price ---------------- */
    if (minPrice || maxPrice) {
      filters.price = {};
      if (minPrice) filters.price.$gte = Number(minPrice);
      if (maxPrice) filters.price.$lte = Number(maxPrice);
    }

    /* ---------------- search ---------------- */
    if (search) {
      filters.$text = { $search: search };
    }

    /* ---------------- sorting ---------------- */
    const sortMap = {
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      newest: { createdAt: -1 },
      rating: { averageRating: -1 },
      popularity: { "analytics.views": -1 },
    };

    const safeLimit = Math.min(200, Math.max(1, Number(limit)));
    const skip = (Number(page) - 1) * safeLimit;
    const sortObj = sortMap[sort] || { createdAt: -1 };

    /* ---------------- query ---------------- */
    const docs = await pop(Product.find(filters))
      .sort(sortObj)
      .skip(skip)
      .limit(safeLimit);

    const total = await Product.countDocuments(filters);

    return res.json({
      category: catDoc
        ? { _id: catDoc._id, name: catDoc.name, slug: catDoc.slug }
        : { raw: categoryParam },

      total,
      page: Number(page),
      pages: Math.ceil(total / safeLimit),
      products: (docs || []).map(applyStockFromVariants),
    });
  } catch (e) {
    console.error("❌ Get Products By Category Error:", e);
    return res.status(500).json({ message: e.message });
  }
};


/* ============================================================
   ✅ GET PRODUCTS BY MULTIPLE IDS (single fetch)
   POST /api/products/by-ids
   body: { ids: ["id1","id2"] }  OR { ids: "id1,id2" }
============================================================ */
export const getProductsByIds = async (req, res) => {
  try {
    let { ids } = req.body;

    // ✅ normalize ids (array/string)
    ids = Array.isArray(ids)
      ? ids
      : typeof ids === "string"
        ? ids.split(",").map((x) => x.trim()).filter(Boolean)
        : [];

    if (!ids.length) {
      return res.status(400).json({ message: "ids array is required" });
    }

    // ✅ split into objectIds + productCodes
    const validObjectIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
    const productCodes = ids.filter((id) => !mongoose.Types.ObjectId.isValid(id)); 
    // (jo ObjectId valid nahi wo productCode consider)

    if (!validObjectIds.length && !productCodes.length) {
      return res.status(400).json({ message: "No valid ids or product codes found" });
    }

    // ✅ fetch using $or
    const docs = await pop(
      Product.find({
        $or: [
          ...(validObjectIds.length ? [{ _id: { $in: validObjectIds } }] : []),
          ...(productCodes.length ? [{ productCode: { $in: productCodes } }] : []),
        ],
      })
    );

    // ✅ map for ordering (both keys)
    const map = new Map();

    docs.forEach((d) => {
      map.set(String(d._id), d);
      if (d.productCode) map.set(String(d.productCode), d);
    });

    // ✅ keep same input order
    const ordered = ids.map((x) => map.get(String(x))).filter(Boolean);

    return res.json({
      requestedCount: ids.length,
      objectIdCount: validObjectIds.length,
      productCodeCount: productCodes.length,
      foundCount: ordered.length,
      products: ordered.map(applyStockFromVariants),
    });
  } catch (e) {
    console.error("❌ Get Products By IDs Error:", e);
    return res.status(500).json({ message: e.message });
  }
};

