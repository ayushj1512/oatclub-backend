// controller/productController.js

import Product from "./Products.js";
import Attribute from "../Attribute/Attribute.js";
import slugify from "slugify";
import mongoose from "mongoose";
import { uploadToCloudinary } from "../config/cloudinary.js";
import { generateVariants } from "../utility/variants.js";
import Category from "../Category/Category.js";
import Collection from "../Collection/Collection.js";

const SYSTEM_CATEGORIES = new Set(["all-clothing", "new-arrivals","best-sellers","featured","party-wear"]);

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
const VARIANT_KEYS = ["size"];
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
  return { size: pick("size") };
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


const skuSafe = (v) =>
  String(v || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const ensureSKUs = async (data) => {
  if (!data || typeof data !== "object") return data;

  // ✅ pick a "real" category for SKU (ignore default/system categories)
  const rawCats = Array.isArray(data.categories) ? data.categories : [];
  const mainCat =
    rawCats.find((c) => !SYSTEM_CATEGORIES.has(String(c).toLowerCase())) ||
    rawCats[0] ||
    "CAT";

  // ✅ category code = first 3 letters only (alphanumeric-safe)
  const onlyLetters = skuSafe(mainCat).replace(/[^A-Z]/g, "");
const categoryCode = (onlyLetters.slice(0, 3) || "CAT");

  // ✅ productCode must exist (you are creating first, then calling ensureSKUs)
  const productCode = skuSafe(data.productCode || "00000");

  const variants = Array.isArray(data.variants) ? data.variants : [];

  /* =====================================================
     SIMPLE PRODUCT
  ===================================================== */
  if (!variants.length) {
    data.productType = "simple";
    data.sku = `${categoryCode}-${productCode}`;
    return data;
  }

  /* =====================================================
     VARIABLE PRODUCT (SIZE ONLY)
  ===================================================== */
  data.productType = "variable";
  if (data.sku) delete data.sku;

  // ✅ remove cross-product / duplicates; keep only size variants
  data.variants = keepOnlySizeVariants(variants);

  data.variants = data.variants.map((v) => {
    const { size } = extractVariantKeys(v);
    const sizePart = skuSafe(size);

    return {
      ...v,
      sku: `${categoryCode}-${productCode}-${sizePart}`,
    };
  });

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

const normalizeSize = (s) =>
  String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

const getVariantSize = (variant) => {
  const attrs = Array.isArray(variant?.attributes) ? variant.attributes : [];
  return (
    attrs.find((a) => String(a?.key || "").toLowerCase() === "size")?.value || ""
  );
};

const keepOnlySizeVariants = (variants = []) => {
  const out = [];
  const seen = new Set();

  for (const v of Array.isArray(variants) ? variants : []) {
    const size = normalizeSize(getVariantSize(v));
    if (!size) continue;
    if (seen.has(size)) continue;

    // remove color attribute if present
    const attrs = Array.isArray(v?.attributes) ? v.attributes : [];
    const cleanedAttrs = attrs.filter(
      (a) => String(a?.key || "").toLowerCase() !== "color"
    );

    out.push({ ...v, attributes: cleanedAttrs });
    seen.add(size);
  }

  return out;
};


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

    data.fabrics = json(data.fabrics, []);
    data.avgFabricConsumption = json(
      data.avgFabricConsumption,
      data.avgFabricConsumption
    );

    // ✅ NEW: COLORS normalize (accept "red,black" OR ["red","black"])
    // This is for easy UI selection at product level.
    if (data.colors !== undefined) {
      data.colors = arr(data.colors)
        .map((c) => String(c || "").trim().toLowerCase())
        .filter(Boolean);
      // remove duplicates
      data.colors = Array.from(new Set(data.colors));
    }

    // ✅ HSN CODE normalize + validate (digits only, optional)
    if (data.hsnCode !== undefined) {
      const hsn = String(data.hsnCode ?? "").trim();
      if (hsn !== "" && !/^\d+$/.test(hsn)) {
        return res
          .status(400)
          .json({ message: "HSN code must contain digits only" });
      }
      data.hsnCode = hsn;
    }

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

    // ✅ Remove system categories + optionally convert new-arrivals -> tag
    const hadNewArrivals = data.categories.some(
      (c) => String(c).toLowerCase() === "new-arrivals"
    );

    data.categories = data.categories.filter(
      (c) => !SYSTEM_CATEGORIES.has(String(c).toLowerCase())
    );

    if (hadNewArrivals) {
      data.tags = Array.from(new Set([...(data.tags || []), "new-arrival"]));
    }

    if (!data.categories.length) {
      return res.status(400).json({
        message:
          "Select a main category like dress/top/shirt etc (all-clothing/new-arrivals are not allowed as main category)",
      });
    }

    /* =====================================================
       BULK PRODUCTS → FORCE SIMPLE + NO VARIANTS
    ===================================================== */
    if (isBulk) {
      data.attributes = [];
      data.variants = [];
      data.productType = "simple";

      // ✅ In bulk, ensure colors is always an array (optional)
      if (!Array.isArray(data.colors)) data.colors = [];
    } else {
      await validateAttributes(data.attributes);

      // safety: strip variant image if any incoming
      if (Array.isArray(data.variants)) {
        data.variants = data.variants.map(({ image, ...v }) => v);
      }

      /* ---------------- auto-generate variants ---------------- */
      data.variants = generateVariants({
        productAttributes: data.attributes,
        existingVariants: [],
        variantKeys: VARIANT_KEYS, // ✅ ["size"]
      });

      // ✅ HARD SAFETY: keep only 1 variant per size + remove color attribute
      data.variants = keepOnlySizeVariants(data.variants);

      data.productType = data.variants.length > 0 ? "variable" : "simple";

      // ✅ normalize variant-level patternNumber
      if (Array.isArray(data.variants)) {
        data.variants = data.variants.map((v) => ({
          ...v,
          patternNumber: String(v?.patternNumber || "").trim(),
        }));
      }

      // ✅ If variable and colors NOT provided, keep it as empty array
      // (because variants currently don't carry color after keepOnlySizeVariants)
      if (!Array.isArray(data.colors)) data.colors = [];
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
      return res
        .status(400)
        .json({ message: "At least one product image is required" });
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

    /* ---------------- create FIRST (so productCode exists) ---------------- */
    const created = await Product.create(data);

    /* ---------------- SKU handling AFTER create ---------------- */
    const skuPayload = created.toObject();

    // ensureSKUs will now generate:
    // - simple: CAT3-PRODUCTCODE
    // - variable: CAT3-PRODUCTCODE-SIZE
    await ensureSKUs(skuPayload);

    created.set({
      sku: skuPayload.sku,
      variants: skuPayload.variants,
      productType: skuPayload.productType,
      // ✅ keep colors as well (if passed/normalized above)
      colors: Array.isArray(data.colors) ? data.colors : [],
    });

    // ✅ IMPORTANT: mark modified for nested variants (if variable)
    if (Array.isArray(skuPayload.variants)) created.markModified("variants");
    created.markModified("colors"); // ✅ NEW

    await created.save({ validateBeforeSave: true });

    /* prevent self cross-sell (safety net) */
    await Product.updateOne(
      { _id: created._id },
      { $pull: { crossSellProducts: created._id } }
    );

    const full = await pop(Product.findById(created._id));

    return res.status(201).json({
      message: isBulk
        ? "Bulk draft product created"
        : "Product created successfully",
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
// controller
export const getProductByIdOrSlug = async (req, res) => {
  try {
    const param = String(req.params.id || "").trim();

    // 1) slug
    let doc = await pop(
      Product.findOne({ slug: param }).populate({
        path: "crossSellProducts",
        select: "title slug price compareAtPrice thumbnail isActive",
        match: { isActive: true },
      })
    );

    // 2) objectId
    if (!doc && mongoose.Types.ObjectId.isValid(param)) {
      doc = await pop(
        Product.findById(param).populate({
          path: "crossSellProducts",
          select: "title slug price compareAtPrice thumbnail isActive",
          match: { isActive: true },
        })
      );
    }

    // 3) productCode (✅ FIX for /api/products/00218)
    if (!doc && /^\d{3,}$/.test(param)) {
      doc = await pop(
        Product.findOne({ productCode: param }).populate({
          path: "crossSellProducts",
          select: "title slug price compareAtPrice thumbnail isActive",
          match: { isActive: true },
        })
      );
    }

    if (!doc) return res.status(404).json({ message: "Product not found" });

    return res.json(applyStockFromVariants(doc));
  } catch (e) {
    console.error("❌ Get Product Error:", e);
    return res.status(500).json({ message: e.message });
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

    if (data.fabrics !== undefined) data.fabrics = json(data.fabrics, data.fabrics);

    if (data.avgFabricConsumption !== undefined) {
      data.avgFabricConsumption = json(
        data.avgFabricConsumption,
        data.avgFabricConsumption
      );
    }

    /* ---------------------------------------------------
       ✅ COLORS normalize (optional)
       Accept "red,black" OR ["red","black"]
    ---------------------------------------------------- */
    if (data.colors !== undefined) {
      const raw = Array.isArray(data.colors)
        ? data.colors
        : String(data.colors || "").split(",");

      data.colors = Array.from(
        new Set(
          raw
            .map((c) => String(c || "").trim().toLowerCase())
            .filter(Boolean)
        )
      );
    }

    /* ---------------------------------------------------
       ✅ HSN CODE normalize + validate (digits only, optional)
    ---------------------------------------------------- */
    if (data.hsnCode !== undefined) {
      const hsn = String(data.hsnCode ?? "").trim();
      if (hsn !== "" && !/^\d+$/.test(hsn)) {
        return res
          .status(400)
          .json({ message: "HSN code must contain digits only" });
      }
      data.hsnCode = hsn;
    }

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

      // ✅ Remove system categories + optionally convert new-arrivals -> tag
      const hadNewArrivals = data.categories.some(
        (c) => String(c).toLowerCase() === "new-arrivals"
      );

      data.categories = data.categories.filter(
        (c) => !SYSTEM_CATEGORIES.has(String(c).toLowerCase())
      );

      if (hadNewArrivals) {
        const existingTags = tagsNorm(data.tags ?? existing.tags); // ✅ safe fallback
        data.tags = Array.from(new Set([...existingTags, "new-arrival"]));
      }

      if (!data.categories.length) {
        return res.status(400).json({
          message:
            "Select a main category like dress/top/shirt etc (all-clothing/new-arrivals are not allowed as main category)",
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

    /* ---------------- VARIANTS ----------------
       ✅ FIX: Preserve existing variant stock/isInStock so they don't reset to 0
       - client can send variants (patternNumber/sku/etc)
       - but inventory fields are preserved from DB (cannot be changed here)
    ---------------------------------------------------------- */
    if (Array.isArray(data.variants)) {
      const existingById = new Map(
        (existing.variants || []).map((v) => [String(v._id), v])
      );

      data.variants = data.variants.map((v) => {
        const prev = v?._id ? existingById.get(String(v._id)) : null;

        return {
          ...(v._id ? { _id: v._id } : {}),
          sku: v.sku,
          barcode: v.barcode ?? "",
          weight: typeof v.weight === "number" ? v.weight : 0,

          // ✅ keep variant-level patternNumber
          patternNumber: String(v?.patternNumber || "").trim(),

          // ✅ inventory preserved (NOT editable via this controller)
          stock: prev?.stock ?? 0,
          isInStock: prev?.isInStock ?? false,

          attributes: Array.isArray(v.attributes) ? v.attributes : [],
        };
      });

      // ✅ HARD SAFETY: keep only 1 variant per size + remove color attribute
      data.variants = keepOnlySizeVariants(data.variants);
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

    // ensureSKUs will generate:
    // - simple: CAT3-PRODUCTCODE
    // - variable: CAT3-PRODUCTCODE-SIZE
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
    if (data.colors !== undefined) existing.markModified("colors");

    const saved = await existing.save({ validateBeforeSave: true });

    const updated = await saved.populate([
      { path: "collections" },
      { path: "offer" },
      { path: "couponsApplicable" },
      { path: "reviews" },
      { path: "crossSellProducts" },
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


export const bulkSyncCollectionOnProducts = async (req, res) => {
  try {
    const { collectionId, addIds, removeIds } = req.body;

    if (!collectionId || !mongoose.Types.ObjectId.isValid(collectionId)) {
      return res.status(400).json({ message: "Valid collectionId is required" });
    }

    const add = [...new Set(arr(addIds))].filter(mongoose.Types.ObjectId.isValid);
    const remove = [...new Set(arr(removeIds))].filter(mongoose.Types.ObjectId.isValid);

    if (!add.length && !remove.length) {
      return res.status(400).json({ message: "addIds or removeIds required" });
    }

    const ops = [];

    // ✅ Add collection to selected products (multi-collection safe + no duplicates)
    if (add.length) {
      ops.push({
        updateMany: {
          filter: { _id: { $in: add } },
          update: { $addToSet: { collections: new mongoose.Types.ObjectId(collectionId) } },
        },
      });
    }

    // ✅ Remove collection from unselected products (doesn't touch other collections)
    if (remove.length) {
      ops.push({
        updateMany: {
          filter: { _id: { $in: remove } },
          update: { $pull: { collections: new mongoose.Types.ObjectId(collectionId) } },
        },
      });
    }

    const result = await Product.bulkWrite(ops, { ordered: false });

    return res.json({
      message: "Product collections synced ✅",
      collectionId,
      addedCount: add.length,
      removedCount: remove.length,
      modifiedCount: result?.modifiedCount ?? 0,
      result,
    });
  } catch (e) {
    console.error("❌ bulkSyncCollectionOnProducts Error:", e);
    return res.status(500).json({ message: e.message });
  }
};


/* ============================================================
   ✅ FETCH PRODUCTS BY CATEGORY
   GET /api/products/fetch-by-category/:category
   Supports:
   ?page&limit&collection&tags&minPrice&maxPrice&isActive&search&sort&sku
============================================================ */
export const fetchProductsByCategory = async (req, res) => {
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

    // category can come from params OR query
    const categoryParam = req.params.category || req.query.category;

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
          { slug: String(categoryParam).toLowerCase() },
          { name: String(categoryParam) },
        ],
      });
    }

    /* ---------------------------------------------------------
       ✅ category match:
       - if found: match both slug + name
       - else: fallback to raw categoryParam stored in Product.categories
    --------------------------------------------------------- */
    const categoryMatch = catDoc
      ? [catDoc.slug, catDoc.name]
      : [String(categoryParam)];

    const filters = { categories: { $in: categoryMatch } };

    /* ---------------- collections ---------------- */
    if (collection) filters.collections = collection;

    /* ---------------- tags ---------------- */
    const t = tagsNorm(tags);
    if (t.length) filters.tags = { $in: t };

    /* ---------------- active ---------------- */
    if (isActive !== undefined) filters.isActive = isActive === "true";

    /* ---------------- SKU ---------------- */
    if (sku) {
      filters.$or = [{ sku: String(sku) }, { "variants.sku": String(sku) }];
    }

    /* ---------------- price ---------------- */
    if (minPrice || maxPrice) {
      filters.price = {};
      if (minPrice) filters.price.$gte = Number(minPrice);
      if (maxPrice) filters.price.$lte = Number(maxPrice);
    }

    /* ---------------- search ---------------- */
    if (search) filters.$text = { $search: search };

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
        : { raw: String(categoryParam) },
      total,
      page: Number(page),
      pages: Math.ceil(total / safeLimit),
      products: (docs || []).map(applyStockFromVariants),
    });
  } catch (e) {
    console.error("❌ fetchProductsByCategory Error:", e);
    return res.status(500).json({ message: e.message });
  }
};


// PATCH /api/products/:id/fabrics
export const updateProductFabrics = async (req, res) => {
  try {
    const { id } = req.params;

    // Accept both: body.fabrics array OR JSON string
    const fabricsRaw = req.body?.fabrics;

    const fabrics =
      typeof fabricsRaw === "string"
        ? (() => {
            try { return JSON.parse(fabricsRaw); } catch { return null; }
          })()
        : fabricsRaw;

    if (!Array.isArray(fabrics)) {
      return res.status(400).json({ message: "fabrics must be an array" });
    }

    // Basic validation + normalize
    const normalized = fabrics.map((f) => ({
      fabricCode: String(f?.fabricCode || "").trim(),
      role: String(f?.role || "main").trim(),
      consumption: {
        value: Number(f?.consumption?.value ?? 0),
        unit: String(f?.consumption?.unit || "meter").trim(),
      },
      notes: String(f?.notes || "").trim(),
    }));

    // Validate required + enums
    const roleSet = new Set(["main", "lining", "contrast", "padding", "other"]);
    const unitSet = new Set(["meter", "gram"]);

    for (const f of normalized) {
      if (!f.fabricCode) {
        return res.status(400).json({ message: "fabricCode is required" });
      }
      if (!roleSet.has(f.role)) {
        return res.status(400).json({ message: `Invalid role: ${f.role}` });
      }
      if (!unitSet.has(f.consumption.unit)) {
        return res
          .status(400)
          .json({ message: `Invalid unit: ${f.consumption.unit}` });
      }
      if (Number.isNaN(f.consumption.value) || f.consumption.value < 0) {
        return res
          .status(400)
          .json({ message: "consumption.value must be >= 0" });
      }
    }

    // Prevent duplicates (fabricCode + role)
    const seen = new Set();
    for (const f of normalized) {
      const key = `${f.fabricCode}__${f.role}`;
      if (seen.has(key)) {
        return res
          .status(400)
          .json({ message: `Duplicate fabric entry: ${f.fabricCode} (${f.role})` });
      }
      seen.add(key);
    }

    const updated = await pop(
      Product.findByIdAndUpdate(
        id,
        { $set: { fabrics: normalized } },
        { new: true, runValidators: true }
      )
    );

    if (!updated) return res.status(404).json({ message: "Product not found" });

    return res.json({
      message: "Fabrics updated successfully",
      product: applyStockFromVariants(updated),
    });
  } catch (e) {
    console.error("❌ updateProductFabrics Error:", e);
    return res.status(500).json({ message: e.message });
  }
};


/* ============================================================
   ✅ GET PRODUCTS BY COLLECTION (slug OR id)
   GET /api/products/by-collection/:collection
   Example:
   /api/products/by-collection/summer-sale
============================================================ */
export const getProductsByCollection = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      tags,
      minPrice,
      maxPrice,
      isActive,
      search,
      sort,
      sku,
    } = req.query;

    const collectionParam = req.params.collection;
    if (!collectionParam) {
      return res.status(400).json({ message: "Collection is required" });
    }

    /* ---------------------------------------------------------
       ✅ Resolve collection by ID OR slug
    --------------------------------------------------------- */
    let collectionDoc = null;

    if (mongoose.Types.ObjectId.isValid(collectionParam)) {
      collectionDoc = await Collection.findById(collectionParam);
    }

    if (!collectionDoc) {
      collectionDoc = await Collection.findOne({
        slug: String(collectionParam).toLowerCase(),
      });
    }

    if (!collectionDoc) {
      return res.status(404).json({ message: "Collection not found" });
    }

    const filters = {
      collections: collectionDoc._id,
    };

    /* ---------------- optional filters ---------------- */
    if (category) {
      const cats = String(category)
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cats.length) filters.categories = { $in: cats };
    }

    const t = tagsNorm(tags);
    if (t.length) filters.tags = { $in: t };

    if (isActive !== undefined) {
      filters.isActive = isActive === "true";
    }

    if (sku) {
      filters.$or = [{ sku }, { "variants.sku": sku }];
    }

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

    const safeLimit = Math.min(200, Math.max(1, Number(limit)));
    const skip = (Number(page) - 1) * safeLimit;
    const sortObj = sortMap[sort] || { createdAt: -1 };

    const docs = await pop(Product.find(filters))
      .sort(sortObj)
      .skip(skip)
      .limit(safeLimit);

    const total = await Product.countDocuments(filters);

    return res.json({
      collection: {
        _id: collectionDoc._id,
        name: collectionDoc.name,
        slug: collectionDoc.slug,
      },
      total,
      page: Number(page),
      pages: Math.ceil(total / safeLimit),
      products: docs.map(applyStockFromVariants),
    });
  } catch (e) {
    console.error("❌ Get Products By Collection Error:", e);
    return res.status(500).json({ message: e.message });
  }
};



/* ============================================================
   ✅ GET BY PRODUCT CODE
   GET /api/products/code/:code
   Example: /api/products/code/00229
============================================================ */
export const getProductByCode = async (req, res) => {
  try {
    const code = String(req.params.code || "").trim();
    if (!code) return res.status(400).json({ message: "productCode is required" });

    // productCode stored as string in DB (like "00229")
    const doc = await pop(
      Product.findOne({ productCode: code }).populate({
        path: "crossSellProducts",
        select: "title slug price compareAtPrice thumbnail isActive",
        match: { isActive: true },
      })
    );

    if (!doc) return res.status(404).json({ message: "Product not found" });

    return res.json(applyStockFromVariants(doc));
  } catch (e) {
    console.error("❌ Get Product By Code Error:", e);
    return res.status(500).json({ message: e.message });
  }
};


// GET /api/products/by-codes?codes=00229,00230,00231
// OR POST /api/products/by-codes  body: { codes: ["00229","00230"] } or { codes: "00229,00230" }

export const getProductsByCodes = async (req, res) => {
  try {
    // allow both GET query and POST body
    let codes = req.query.codes ?? req.body.codes;

    // normalize codes (array/string)
    codes = Array.isArray(codes)
      ? codes
      : typeof codes === "string"
        ? codes.split(",").map((x) => String(x).trim()).filter(Boolean)
        : [];

    if (!codes.length) {
      return res.status(400).json({ message: "codes is required" });
    }

    // productCode stored as string (e.g. "00229"), so keep as string
    const docs = await pop(
      Product.find({ productCode: { $in: codes } })
    );

    // ✅ keep same order as input
    const map = new Map();
    docs.forEach((d) => map.set(String(d.productCode), d));
    const ordered = codes.map((c) => map.get(String(c))).filter(Boolean);

    return res.json({
      requestedCount: codes.length,
      foundCount: ordered.length,
      missingCodes: codes.filter((c) => !map.has(String(c))),
      products: ordered.map(applyStockFromVariants),
    });
  } catch (e) {
    console.error("❌ getProductsByCodes Error:", e);
    return res.status(500).json({ message: e.message });
  }
};
