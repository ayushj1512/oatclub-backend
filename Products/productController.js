// controller/productController.js

import Product from "./Products.js";
import Attribute from "../Attribute/Attribute.js";
import slugify from "slugify";
import mongoose from "mongoose";
import { uploadToCloudinary } from "../config/cloudinary.js";
import { generateVariants } from "../utility/variants.js";
import Category from "../Category/Category.js";
import Collection from "../Collection/Collection.js";
import { reconcileBackordersForVariant } from "../inventoryUtility/reconcileBackordersForVariant.js";

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

  // ✅ SIMPLE
  if (!isVariable) {
    const stock = Number(p.stock ?? 0);
    const reserved = Number(p.reservedStock ?? 0);
    const available = Math.max(0, stock - reserved);

    return {
      ...p,
      stock,                 // physical
      reservedStock: reserved,
      availableStock: available,
      isInStock: available > 0,
    };
  }

  // ✅ VARIABLE
  const physicalTotal = variants.reduce((s, v) => s + Number(v?.stock ?? 0), 0);
  const reservedTotal = variants.reduce(
    (s, v) => s + Number(v?.reservedStock ?? 0),
    0
  );

  const anyAvailable = variants.some((v) => {
    const st = Number(v?.stock ?? 0);
    const rs = Number(v?.reservedStock ?? 0);
    return Math.max(0, st - rs) > 0;
  });

  return {
    ...p,
    stock: physicalTotal,           // physical total
    reservedStock: reservedTotal,   // total reserved (computed)
    availableStock: Math.max(0, physicalTotal - reservedTotal),
    isInStock: anyAvailable,
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


const escapeRegex = (s = "") =>
  String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isDigitsOnly = (v) => /^\d+$/.test(String(v ?? "").trim());

const normalizeCode = (digits, padTo) => {
  const d = String(digits ?? "").replace(/[^\d]/g, "");
  if (!d) return "";
  const tail = d.length > padTo ? d.slice(-padTo) : d;
  return tail.length >= padTo ? tail : tail.padStart(padTo, "0");
};

const buildCodeCandidates = (raw) => {
  const digits = String(raw ?? "").trim().replace(/[^\d]/g, "");
  if (!digits) return [];
  const set = new Set();

  set.add(digits);
  set.add(digits.replace(/^0+/, "") || "0");

  // DB: "00336" style
  set.add(normalizeCode(digits, 5));
  // some SKUs could have 6-digit
  set.add(normalizeCode(digits, 6));

  if (digits.length >= 6) set.add(digits.slice(-6));
  if (digits.length >= 5) set.add(digits.slice(-5));

  return Array.from(set).filter(Boolean);
};

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const slugifySafe = (s = "") =>
  String(s)
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const getCardCategorySlug = (categories = []) => {
  const list = Array.isArray(categories) ? categories : [];
  const preferred =
    list.find((c) => c && !SYSTEM_CATEGORIES.has(String(c).toLowerCase())) ||
    list[0] ||
    "products";

  return slugifySafe(preferred);
};


const resolveCollectionFilter = async (collection) => {
  const rawCollections = Array.isArray(collection)
    ? collection
    : String(collection || "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);

  if (!rawCollections.length) return null;

  const objectIds = rawCollections.filter((c) =>
    mongoose.Types.ObjectId.isValid(c)
  );

  const nonIds = rawCollections.filter(
    (c) => !mongoose.Types.ObjectId.isValid(c)
  );

  let matchedIds = [...objectIds];

  if (nonIds.length) {
    const escaped = nonIds.map((s) =>
      String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );

    const docs = await Collection.find({
      $or: [
        { slug: { $in: nonIds.map((s) => String(s).toLowerCase()) } },
        { name: { $in: nonIds } },
        { name: { $in: escaped.map((s) => new RegExp(`^${s}$`, "i")) } },
      ],
    })
      .select("_id slug name")
      .lean();

    matchedIds.push(...docs.map((d) => String(d._id)));
  }

  matchedIds = Array.from(new Set(matchedIds.map(String))).filter(Boolean);

  if (!matchedIds.length) return { $in: [] };
  if (matchedIds.length === 1) return matchedIds[0];
  return { $in: matchedIds };
};

const mapProductCard = (p) => {
  const image = p?.thumbnail || p?.images?.[0] || "";
  const hoverImage = p?.images?.[1] || null;

  const price = toNum(p?.price);
  const compareAtPrice = toNum(p?.compareAtPrice);

  const categorySlug = getCardCategorySlug(p?.categories);
  const safeSlug = slugifySafe(p?.slug || p?.title || "product");
  const productCode = String(p?.productCode || "").trim();

  return {
    _id: p._id,
    title: String(p?.title || "").trim(),
    slug: safeSlug,
    productCode,
    categories: Array.isArray(p?.categories) ? p.categories : [],
    thumbnail: image,
    image,
    hoverImage,
    price,
    compareAtPrice,
    isBestSeller: !!p?.isBestSeller,
    isTrending: !p?.isBestSeller && !!p?.isTrending,
    isPrimaryProduct: !!p?.isPrimaryProduct,
    categorySlug,
    productLink: `/category/${categorySlug}/${safeSlug}/${encodeURIComponent(productCode)}`,
    discount:
      compareAtPrice > price && price > 0
        ? Math.round(((compareAtPrice - price) / compareAtPrice) * 100)
        : 0,
  };
};



/**
 * Adds code-search filter to `filters` when query has:
 * productCode / code / q / title (digits)
 *
 * - exact productCode match via $in
 * - sku / variants.sku partial match via regex (contains)
 */
const applyProductCodeFilter = (filters, query) => {
  const raw =
    query.productCode ??
    query.code ??
    query.q ??
    query.title ??
    query.search ??   // ✅ add this
    "";

  const s = String(raw ?? "").trim();
  if (!s) return;

  if (isDigitsOnly(s)) {
    const codes = buildCodeCandidates(s);
    const skuRegex = new RegExp(escapeRegex(normalizeCode(s, 5)), "i");

    const or = Array.isArray(filters.$or) ? filters.$or : [];

    or.push({ productCode: { $in: codes } });
    or.push({ sku: skuRegex });
    or.push({ "variants.sku": skuRegex });

    filters.$or = or;
  }
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
  if (!variant) return "";
  if (variant.size) return String(variant.size); // ✅ support direct field

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


// controllers/productController.js
export const createProduct = async (req, res) => {
  try {
    const data = { ...req.body };
    const isBulk = data.importSource === "bulk";

    /* ---------------- helpers ---------------- */
    const s = (v) => String(v ?? "").trim();
    const toBool = (v) =>
      typeof v === "boolean" ? v : ["true", "1", "yes"].includes(s(v).toLowerCase());

    const normSpecs = (v) => {
      const out = [];
      const push = (k, val) => {
        const key = s(k),
          value = s(val);
        if (key) out.push({ key, value });
      };

      if (typeof v === "string") {
        const t = v.trim();
        if (!t) return [];
        try {
          v = JSON.parse(t);
        } catch {
          (t.includes("|") ? t.split("|") : t.split(",")).forEach((p) => {
            const x = s(p);
            if (!x) return;
            const sep = x.includes(":") ? ":" : x.includes("=") ? "=" : null;
            if (!sep) return;
            const [k, ...rest] = x.split(sep);
            push(k, rest.join(sep));
          });
          return out;
        }
      }

      if (Array.isArray(v)) return v.forEach((r) => r && push(r.key, r.value)), out;
      if (v && typeof v === "object")
        return Object.entries(v).forEach(([k, val]) => push(k, val)), out;

      return [];
    };

    const normFabrics = (v) => {
      const ROLES = new Set(["main", "lining", "contrast", "padding", "other"]);
      const out = [];

      const push = (row) => {
        if (!row) return;

        if (typeof row === "string") {
          const name = s(row);
          if (name) {
            out.push({
              fabricName: name,
              fabricCode: "",
              fabricColor: "",
              role: "main",
            });
          }
          return;
        }

        if (typeof row !== "object") return;

        const fabricName = s(row.fabricName);
        const fabricCode = s(row.fabricCode);
        const fabricColor = s(row.fabricColor);
        const roleRaw = s(row.role || "main").toLowerCase();
        const role = ROLES.has(roleRaw) ? roleRaw : "main";

        const hasAny = !!(fabricName || fabricCode || fabricColor || s(row.role));
        if (!hasAny) return;

        const finalName = fabricName || fabricCode;
        if (!finalName) throw new Error("Fabric name is required in fabrics[]");

        out.push({
          fabricName: finalName,
          fabricCode: fabricCode || "",
          fabricColor: fabricColor || "",
          role,
        });
      };

      if (typeof v === "string") {
        const t = v.trim();
        if (!t) return [];
        try {
          v = JSON.parse(t);
        } catch {
          (t.includes("|") ? t.split("|") : t.split(",")).forEach((p) =>
            push(String(p || ""))
          );
          return out;
        }
      }

      if (Array.isArray(v)) return v.forEach(push), out;

      if (v && typeof v === "object") {
        const looksSingle =
          "fabricName" in v ||
          "fabricCode" in v ||
          "fabricColor" in v ||
          "role" in v;

        if (looksSingle) return push(v), out;

        Object.entries(v).forEach(([role, name]) =>
          push({ role, fabricName: name })
        );
        return out;
      }

      return [];
    };

    /* ---------------- normalize basics ---------------- */
    data.attributes = json(data.attributes, []);

    data.shortDescription = s(data.shortDescription);
    data.howToStyle = s(data.howToStyle);
    data.fabricDetails = s(data.fabricDetails);

    data.keyFeatures =
      data.keyFeatures !== undefined
        ? json(data.keyFeatures, [])
        : data.highlights !== undefined
        ? json(data.highlights, [])
        : [];
    delete data.highlights;

    data.specifications = normSpecs(data.specifications ?? data.specs);
    delete data.specs;

    data.keywords = arr(data.keywords);
    data.tags = tagsNorm(data.tags);
    data.collections = arr(data.collections);

    // ✅ extra schema fields
    data.isPatternReady =
      data.isPatternReady !== undefined ? toBool(data.isPatternReady) : false;

    data.originalProductLink = s(data.originalProductLink || data.productLink);
    delete data.productLink;

    // ✅ NEW: primary product flag
    data.isPrimaryProduct =
      data.isPrimaryProduct !== undefined ? toBool(data.isPrimaryProduct) : true;

    // ✅ trending + bestseller
    data.isBestSeller =
      data.isBestSeller !== undefined ? toBool(data.isBestSeller) : false;
    data.isTrending =
      data.isTrending !== undefined ? toBool(data.isTrending) : false;
// ✅ Available for collaboration
data.availableForCollab =
  data.availableForCollab !== undefined
    ? toBool(data.availableForCollab)
    : false;
    // ✅ fabrics
    try {
      data.fabrics = data.fabrics !== undefined ? normFabrics(data.fabrics) : [];
    } catch (err) {
      return res.status(400).json({ message: err.message || "Invalid fabrics" });
    }

    data.avgFabricConsumption = json(
      data.avgFabricConsumption,
      data.avgFabricConsumption
    );

    if (data.colors !== undefined) {
      data.colors = Array.from(
        new Set(arr(data.colors).map((c) => s(c).toLowerCase()).filter(Boolean))
      );
    }

    if (data.hsnCode !== undefined) {
      const hsn = s(data.hsnCode);
      if (hsn && !/^\d+$/.test(hsn)) {
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
      ? data.categories.split(",").map((c) => s(c)).filter(Boolean)
      : [];

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

    /* ---------------- variants ---------------- */
    if (isBulk) {
      data.attributes = [];
      data.variants = [];
      data.productType = "simple";
      data.colors = Array.isArray(data.colors) ? data.colors : [];
      data.specifications = Array.isArray(data.specifications)
        ? data.specifications
        : [];
    } else {
      await validateAttributes(data.attributes);

      if (Array.isArray(data.variants)) {
        data.variants = data.variants.map(({ image, ...v }) => v);
      }

      data.variants = keepOnlySizeVariants(
        generateVariants({
          productAttributes: data.attributes,
          existingVariants: [],
          variantKeys: VARIANT_KEYS,
        })
      );

      data.productType = data.variants.length ? "variable" : "simple";
      data.variants = (data.variants || []).map((v) => ({
        ...v,
        patternNumber: s(v?.patternNumber),
      }));

      if (!Array.isArray(data.colors)) data.colors = [];
      if (!Array.isArray(data.specifications)) data.specifications = [];
    }

    // ✅ AUTO set isPatternReady based on variants
    data.isPatternReady =
      Array.isArray(data.variants) &&
      data.variants.some(
        (v) => v?.patternNumber && String(v.patternNumber).trim()
      );

    /* ---------------- cross-sell ---------------- */
    data.crossSellProducts = (
      Array.isArray(data.crossSellProducts)
        ? data.crossSellProducts
        : typeof data.crossSellProducts === "string"
        ? data.crossSellProducts.split(",").map((id) => s(id))
        : []
    ).filter(isValidObjectId);

    /* ---------------- uploads ---------------- */
    const { images, thumbnail } = await mergeUploads(req, {
      images: data.images,
      thumbnail: data.thumbnail,
    });

    data.images = images;
    data.thumbnail = thumbnail;

    if (!isBulk && (!data.images || !data.images.length)) {
      return res
        .status(400)
        .json({ message: "At least one product image is required" });
    }

    if (isBulk) {
      data.images = [];
      data.thumbnail = "";
      data.isDraft = true;
      data.isActive = false;
      data.isPatternReady = false;
      data.isPrimaryProduct = true;
    }

    /* ---------------- create + sku ---------------- */
    const created = await Product.create(data);

    const skuPayload = created.toObject();
    await ensureSKUs(skuPayload);

    created.set({
      sku: skuPayload.sku,
      variants: skuPayload.variants,
      productType: skuPayload.productType,
      colors: Array.isArray(data.colors) ? data.colors : [],
      shortDescription: data.shortDescription || "",
      howToStyle: data.howToStyle || "",
      fabricDetails: data.fabricDetails || "",
      keyFeatures: Array.isArray(data.keyFeatures) ? data.keyFeatures : [],
      specifications: Array.isArray(data.specifications) ? data.specifications : [],
      isBestSeller: !!data.isBestSeller,
      isTrending: !!data.isTrending,
        availableForCollab: !!data.availableForCollab,

      isPatternReady: !!data.isPatternReady,
      isPrimaryProduct: !!data.isPrimaryProduct,
      originalProductLink: data.originalProductLink || "",
    });

    if (Array.isArray(skuPayload.variants)) created.markModified("variants");

    [
      "colors",
      "keyFeatures",
      "shortDescription",
      "howToStyle",
      "fabricDetails",
      "specifications",
    ].forEach((k) => created.markModified(k));

    [
      "isBestSeller",
      "isTrending",
      "isPatternReady",
      "isPrimaryProduct",
      "originalProductLink",
    ].forEach((k) => created.markModified(k));

    await created.save({ validateBeforeSave: true });

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
/* ============================================================
   ✅ GET ALL
   - backward compatible
   - server-side filtering + pagination
   - supports old params + extra model filters
============================================================ */
export const getAllProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,

      category,
      collection,
      tags,
      minPrice,
      maxPrice,

      isActive,
      isDraft,
      isBestSeller,
      isTrending,
      isPrimaryProduct,
      isFeatured,
      isPatternReady,
      isSamplingDone,
      isInStock,

      productType,
      currency,
      taxClass,
      color,
      colors,
      fabricName,
      fabricCode,
      fabricColor,
      role,
      hsnCode,
      sku,
      slug,
      titleExact,
      externalURL,
      originalProductLink,
      wordpressId,

      minRating,
      maxRating,
      minViews,
      maxViews,
      minPurchases,
      maxPurchases,
      minCartAdds,
      maxCartAdds,
      minWishlistCount,
      maxWishlistCount,
      minSearchAppearances,
      maxSearchAppearances,

      minStock,
      maxStock,
      minReservedStock,
      maxReservedStock,

      createdFrom,
      createdTo,
      updatedFrom,
      updatedTo,
      publishFrom,
      publishTo,

      sort,
      sortKey,
      sortDir,

      search,
      q,
      title,
      productCode,
      code,
    } = req.query;

    const filters = {};
    const andFilters = [];

    const toStr = (v) => String(v ?? "").trim();
    const toNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const toBool = (v) => String(v).trim().toLowerCase() === "true";
    const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== "";

    const toArray = (v) => {
      if (Array.isArray(v)) {
        return v.map((x) => String(x).trim()).filter(Boolean);
      }
      return String(v ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    };

    const escapeRegex = (value = "") =>
      String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const addRange = (field, min, max) => {
      const minNum = toNum(min);
      const maxNum = toNum(max);
      if (minNum === null && maxNum === null) return;

      filters[field] = {};
      if (minNum !== null) filters[field].$gte = minNum;
      if (maxNum !== null) filters[field].$lte = maxNum;
    };

    const addDateRange = (field, from, to) => {
      const range = {};
      const fromDate = hasVal(from) ? new Date(from) : null;
      const toDate = hasVal(to) ? new Date(to) : null;

      if (fromDate && !Number.isNaN(fromDate.getTime())) {
        range.$gte = fromDate;
      }

      if (toDate && !Number.isNaN(toDate.getTime())) {
        range.$lte = toDate;
      }

      if (Object.keys(range).length) {
        filters[field] = range;
      }
    };

    /* ---------------- categories ---------------- */
    if (hasVal(category)) {
      const cats = toArray(category);
      if (cats.length) filters.categories = { $in: cats };
    }

    /* ---------------- collections ---------------- */
    if (hasVal(collection)) {
      const collections = toArray(collection);
      if (collections.length === 1) filters.collections = collections[0];
      else if (collections.length > 1) filters.collections = { $in: collections };
    }

    /* ---------------- tags ---------------- */
    const normalizedTags = tagsNorm(tags);
    if (normalizedTags.length) {
      filters.tags = { $in: normalizedTags };
    }

    /* ---------------- booleans ---------------- */
    if (hasVal(isActive)) filters.isActive = toBool(isActive);
    if (hasVal(isDraft)) filters.isDraft = toBool(isDraft);
    if (hasVal(isBestSeller)) filters.isBestSeller = toBool(isBestSeller);
    if (hasVal(isTrending)) filters.isTrending = toBool(isTrending);
    if (hasVal(isPrimaryProduct)) filters.isPrimaryProduct = toBool(isPrimaryProduct);
    if (hasVal(isFeatured)) filters.isFeatured = toBool(isFeatured);
    if (hasVal(isPatternReady)) filters.isPatternReady = toBool(isPatternReady);
    if (hasVal(isSamplingDone)) filters.isSamplingDone = toBool(isSamplingDone);
    if (hasVal(isInStock)) filters.isInStock = toBool(isInStock);

    /* ---------------- exact/simple filters ---------------- */
    if (hasVal(productType)) filters.productType = toStr(productType);
    if (hasVal(currency)) filters.currency = toStr(currency).toUpperCase();
    if (hasVal(taxClass)) filters.taxClass = toStr(taxClass);
    if (hasVal(slug)) filters.slug = toStr(slug).toLowerCase();
    if (hasVal(hsnCode)) filters.hsnCode = toStr(hsnCode).replace(/[^\d]/g, "");
    if (hasVal(externalURL)) filters.externalURL = toStr(externalURL);
    if (hasVal(originalProductLink)) filters.originalProductLink = toStr(originalProductLink);
    if (hasVal(wordpressId) && toNum(wordpressId) !== null) {
      filters.wordpressId = toNum(wordpressId);
    }

    /* ---------------- arrays / nested string filters ---------------- */
    const colorList = [...toArray(colors), ...toArray(color)].map((x) => x.toLowerCase());
    if (colorList.length) filters.colors = { $in: [...new Set(colorList)] };

    if (hasVal(fabricName)) {
      filters["fabrics.fabricName"] = { $regex: escapeRegex(toStr(fabricName)), $options: "i" };
    }

    if (hasVal(fabricCode)) {
      filters["fabrics.fabricCode"] = { $regex: escapeRegex(toStr(fabricCode)), $options: "i" };
    }

    if (hasVal(fabricColor)) {
      filters["fabrics.fabricColor"] = { $regex: escapeRegex(toStr(fabricColor)), $options: "i" };
    }

    if (hasVal(role)) {
      filters["fabrics.role"] = toStr(role).toLowerCase();
    }

    /* ---------------- SKU exact / partial ---------------- */
    if (hasVal(sku)) {
      const skuVal = toStr(sku);
      andFilters.push({
        $or: [
          { sku: skuVal },
          { "variants.sku": skuVal },
          { sku: { $regex: escapeRegex(skuVal), $options: "i" } },
          { "variants.sku": { $regex: escapeRegex(skuVal), $options: "i" } },
        ],
      });
    }

    /* ---------------- productCode helper (existing safe) ---------------- */
    applyProductCodeFilter(filters, { q, title, productCode, code, search });

    /* ---------------- exact title ---------------- */
    if (hasVal(titleExact)) {
      filters.title = { $regex: `^${escapeRegex(toStr(titleExact))}$`, $options: "i" };
    }

    /* ---------------- price / stock / analytics ranges ---------------- */
    addRange("price", minPrice, maxPrice);
    addRange("stock", minStock, maxStock);
    addRange("reservedStock", minReservedStock, maxReservedStock);
    addRange("averageRating", minRating, maxRating);

    addRange("analytics.views", minViews, maxViews);
    addRange("analytics.purchases", minPurchases, maxPurchases);
    addRange("analytics.cartAdds", minCartAdds, maxCartAdds);
    addRange("analytics.wishlistCount", minWishlistCount, maxWishlistCount);
    addRange("analytics.searchAppearances", minSearchAppearances, maxSearchAppearances);

    /* ---------------- date ranges ---------------- */
    addDateRange("createdAt", createdFrom, createdTo);
    addDateRange("updatedAt", updatedFrom, updatedTo);
    addDateRange("publishAt", publishFrom, publishTo);

    /* ---------------- generic text search ---------------- */
    const qStr = toStr(q);
    const titleStr = toStr(title);
    const searchStr = toStr(search);
    const pcStr = toStr(productCode);
    const codeStr = toStr(code);

    const isCodeQuery =
      isDigitsOnly(qStr) ||
      isDigitsOnly(titleStr) ||
      isDigitsOnly(searchStr) ||
      isDigitsOnly(pcStr) ||
      isDigitsOnly(codeStr);

    const searchText = !isCodeQuery ? searchStr || qStr || titleStr : "";

    if (searchText) {
      const rx = { $regex: escapeRegex(searchText), $options: "i" };

      andFilters.push({
        $or: [
          { title: rx },
          { slug: rx },
          { shortDescription: rx },
          { howToStyle: rx },
          { fabricDetails: rx },
          { sku: rx },
          { productCode: rx },
          { hsnCode: rx },
          { tags: rx },
          { colors: rx },
          { keyFeatures: rx },
          { "variants.sku": rx },
          { "variants.barcode": rx },
          { "variants.patternNumber": rx },
          { "fabrics.fabricName": rx },
          { "fabrics.fabricCode": rx },
          { "fabrics.fabricColor": rx },
          { "specifications.key": rx },
          { "specifications.value": rx },
        ],
      });
    }

    /* ---------------- final query ---------------- */
    let finalFilters = { ...filters };

    if (andFilters.length) {
      finalFilters = {
        ...filters,
        $and: andFilters,
      };
    }

    /* ---------------- sorting ---------------- */
    const sortMap = {
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      updated_desc: { updatedAt: -1 },
      updated_asc: { updatedAt: 1 },
      rating: { averageRating: -1 },
      popularity: { "analytics.views": -1 },
      views_desc: { "analytics.views": -1 },
      views_asc: { "analytics.views": 1 },
      purchases_desc: { "analytics.purchases": -1 },
      purchases_asc: { "analytics.purchases": 1 },
      title_asc: { title: 1 },
      title_desc: { title: -1 },
      stock_asc: { stock: 1 },
      stock_desc: { stock: -1 },
    };

    let sortObj = sortMap[sort] || { createdAt: -1 };

    if (hasVal(sortKey)) {
      const dir = String(sortDir).toLowerCase() === "asc" ? 1 : -1;

      const allowedSortKeys = new Set([
        "title",
        "slug",
        "price",
        "compareAtPrice",
        "stock",
        "reservedStock",
        "averageRating",
        "totalReviews",
        "createdAt",
        "updatedAt",
        "publishAt",
        "productCode",
        "sku",
        "wordpressId",
        "analytics.views",
        "analytics.purchases",
        "analytics.cartAdds",
        "analytics.wishlistCount",
        "analytics.searchAppearances",
      ]);

      if (allowedSortKeys.has(sortKey)) {
        sortObj = { [sortKey]: dir };
      }
    }

    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 20));
    const safePage = Math.max(1, Number(page) || 1);
    const skip = (safePage - 1) * safeLimit;

    const query = Product.find(finalFilters)
      .sort(sortObj)
      .skip(skip)
      .limit(safeLimit);

    const docs = await pop(query);
    const total = await Product.countDocuments(finalFilters);

    return res.json({
      total,
      page: safePage,
      pages: Math.ceil(total / safeLimit),
      products: (docs || []).map(applyStockFromVariants),
    });
  } catch (e) {
    console.error("❌ Get All Products Error:", e);
    return res.status(500).json({ message: e.message });
  }
};


/* ============================================================
   GET PRODUCTS AVAILABLE FOR COLLAB

   GET /api/products/available-for-collab

   Query params:
   - page
   - limit
   - search
   - category
   - sort
============================================================ */
export const getAvailableForCollabProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 24,
      search = "",
      category = "",
      sort = "newest",
    } = req.query;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 24));
    const skip = (safePage - 1) * safeLimit;

    const filters = {
      availableForCollab: true,
      isActive: true,
      isDraft: false,
    };

    /* ---------------- category ---------------- */
    const categoryValue = String(category || "").trim();

    if (categoryValue) {
      filters.categories = categoryValue;
    }

    /* ---------------- search ---------------- */
    const searchValue = String(search || "").trim();

    if (searchValue) {
      const escapedSearch = escapeRegex(searchValue);

      filters.$or = [
        {
          title: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
        {
          productCode: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
        {
          slug: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
        {
          tags: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
        {
          categories: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
      ];
    }

    /* ---------------- sorting ---------------- */
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      title_asc: { title: 1 },
      title_desc: { title: -1 },
      trending: { isTrending: -1, createdAt: -1 },
      bestseller: { isBestSeller: -1, createdAt: -1 },
    };

    const sortObj = sortMap[sort] || sortMap.newest;

    /*
     * ProductCard requires:
     * - identity/link fields
     * - images
     * - price
     * - badge flags
     * - attributes/variants for size selection and add-to-cart
     *
     * Heavy fields such as description, reviews, analytics,
     * fabrics, specifications and cross-sells are excluded.
     */
    const cardFields = [
      "_id",
      "title",
      "slug",
      "productCode",
      "categories",
      "thumbnail",
      "images",
      "price",
      "compareAtPrice",
      "currency",
      "attributes",
      "variants._id",
      "variants.attributes",
      "variants.sku",
      "variants.stock",
      "variants.reservedStock",
      "variants.isInStock",
      "sku",
      "stock",
      "reservedStock",
      "isInStock",
      "productType",
      "isBestSeller",
      "isTrending",
      "availableForCollab",
    ].join(" ");

    const [docs, total] = await Promise.all([
      Product.find(filters)
        .select(cardFields)
        .sort(sortObj)
        .skip(skip)
        .limit(safeLimit)
        .lean(),

      Product.countDocuments(filters),
    ]);

    const products = docs.map((product) => {
      const image =
        product.thumbnail ||
        (Array.isArray(product.images) ? product.images[0] : "") ||
        "";

      const hoverImage =
        Array.isArray(product.images) && product.images.length > 1
          ? product.images[1]
          : null;

      return {
        _id: product._id,
        title: product.title,
        slug: product.slug,
        productCode: product.productCode,
        categories: product.categories || [],

        thumbnail: image,
        image,
        hoverImage,
        images: product.images || [],

        price: Number(product.price || 0),
        compareAtPrice:
          product.compareAtPrice !== null &&
          product.compareAtPrice !== undefined
            ? Number(product.compareAtPrice)
            : null,

        currency: product.currency || "INR",

        sku: product.sku || "",
        productType: product.productType || "simple",

        stock: Number(product.stock || 0),
        reservedStock: Number(product.reservedStock || 0),
        isInStock: !!product.isInStock,

        attributes: product.attributes || [],
        variants: product.variants || [],

        isBestSeller: !!product.isBestSeller,
        isTrending: !!product.isTrending,
        availableForCollab: true,
      };
    });

    return res.status(200).json({
      success: true,
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit),
      hasNextPage: safePage * safeLimit < total,
      hasPreviousPage: safePage > 1,
      products,
    });
  } catch (error) {
    console.error("❌ Get Available For Collab Products Error:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to fetch products available for collaboration",
    });
  }
};


/* ============================================================
   UPDATE COLLAB READY STATUS
   Supports single + bulk

   Single:
   PATCH /api/products/:id/collab-ready
   body: { availableForCollab: true }

   Bulk:
   PATCH /api/products/bulk/collab-ready
   body: {
     ids: ["productId1", "productId2"],
     availableForCollab: false
   }
============================================================ */
export const updateCollabReadyStatus = async (req, res) => {
  try {
    const rawStatus =
      req.body?.availableForCollab ??
      req.body?.collabReady ??
      req.body?.status;

    if (rawStatus === undefined || rawStatus === null) {
      return res.status(400).json({
        success: false,
        message: "availableForCollab is required",
      });
    }

    const availableForCollab =
      typeof rawStatus === "boolean"
        ? rawStatus
        : ["true", "1", "yes"].includes(
            String(rawStatus).trim().toLowerCase()
          );

    const rawIds = req.params?.id
      ? [req.params.id]
      : req.body?.ids ?? req.body?.productIds ?? [];

    const ids = (
      Array.isArray(rawIds)
        ? rawIds
        : String(rawIds || "").split(",")
    )
      .map((item) =>
        item && typeof item === "object" && item._id
          ? String(item._id)
          : String(item || "").trim()
      )
      .filter(Boolean);

    const uniqueIds = [...new Set(ids)];

    if (!uniqueIds.length) {
      return res.status(400).json({
        success: false,
        message: "At least one product ID is required",
      });
    }

    const invalidIds = uniqueIds.filter(
      (id) => !mongoose.Types.ObjectId.isValid(id)
    );

    if (invalidIds.length) {
      return res.status(400).json({
        success: false,
        message: "Some product IDs are invalid",
        invalidIds,
      });
    }

    const result = await Product.updateMany(
      {
        _id: { $in: uniqueIds },
      },
      {
        $set: {
          availableForCollab,
        },
      }
    );

    const updatedProducts = await Product.find({
      _id: { $in: uniqueIds },
    })
      .select(
        "_id title slug productCode thumbnail availableForCollab"
      )
      .lean();

    return res.status(200).json({
      success: true,
      message: availableForCollab
        ? `${result.modifiedCount} product(s) marked collab ready`
        : `${result.modifiedCount} product(s) removed from collab ready`,

      requestedCount: uniqueIds.length,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      availableForCollab,
      products: updatedProducts,
    });
  } catch (error) {
    console.error("❌ Update Collab Ready Status Error:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message || "Failed to update collab ready status",
    });
  }
};


/* ============================================================
   GET BY ID OR SLUG
============================================================ */
// controller
export const getProductByIdOrSlug = async (req, res) => {
  try {
    const param = String(req.params.id || "").trim();

    // Helper (keep here or import from utils)
    const buildCodeCandidates = (input) => {
      const raw = String(input || "").trim();
      const digits = raw.replace(/\D/g, "");
      if (!digits) return [];

      const n = parseInt(digits, 10);
      if (Number.isNaN(n)) return [];

      const padded5 = String(n).padStart(5, "0"); // "00218"
      return Array.from(new Set([raw, digits, padded5]));
    };

    const crossSellPopulate = {
      path: "crossSellProducts",
      select: "title slug price compareAtPrice thumbnail isActive",
      match: { isActive: true },
    };

    let doc = null;

    // 1) slug
    doc = await pop(Product.findOne({ slug: param }).populate(crossSellPopulate));

    // 2) objectId
    if (!doc && mongoose.Types.ObjectId.isValid(param)) {
      doc = await pop(Product.findById(param).populate(crossSellPopulate));
    }

    // 3) productCode (supports /api/products/218 when DB has "00218")
    // If you only want 3+ digits, change to: /^\d{3,}$/
    if (!doc && /^\d+$/.test(param)) {
      const codes = buildCodeCandidates(param);

      doc = await pop(
        Product.findOne({ productCode: { $in: codes } }).populate(crossSellPopulate)
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

    /* ---------------- helpers ---------------- */
    const s = (v) => String(v ?? "").trim();
    const toBool = (v) =>
      typeof v === "boolean" ? v : ["true", "1", "yes"].includes(s(v).toLowerCase());

    const normColors = (v) =>
      Array.from(
        new Set(
          (Array.isArray(v) ? v : String(v || "").split(","))
            .map((c) => s(c).toLowerCase())
            .filter(Boolean)
        )
      );

    const normSpecs = (v) => {
      const out = [];
      const push = (k, val) => {
        const key = s(k),
          value = s(val);
        if (key) out.push({ key, value });
      };

      if (typeof v === "string") {
        const t = v.trim();
        if (!t) return [];
        try {
          v = JSON.parse(t);
        } catch {
          (t.includes("|") ? t.split("|") : t.split(",")).forEach((p) => {
            const x = s(p);
            if (!x) return;
            const sep = x.includes(":") ? ":" : x.includes("=") ? "=" : null;
            if (!sep) return;
            const [k, ...rest] = x.split(sep);
            push(k, rest.join(sep));
          });
          return out;
        }
      }

      if (Array.isArray(v)) return v.forEach((r) => r && push(r.key, r.value)), out;
      if (v && typeof v === "object")
        return Object.entries(v).forEach(([k, val]) => push(k, val)), out;

      return [];
    };

    const normFabrics = (v) => {
      const ROLES = new Set(["main", "lining", "contrast", "padding", "other"]);
      const out = [];

      const push = (row) => {
        if (!row) return;

        if (typeof row === "string") {
          const name = s(row);
          if (name) {
            out.push({
              fabricName: name,
              fabricCode: "",
              fabricColor: "",
              role: "main",
            });
          }
          return;
        }

        if (typeof row !== "object") return;

        const fabricName = s(row.fabricName);
        const fabricCode = s(row.fabricCode);
        const fabricColor = s(row.fabricColor);
        const roleRaw = s(row.role || "main").toLowerCase();
        const role = ROLES.has(roleRaw) ? roleRaw : "main";

        const hasAny = !!(fabricName || fabricCode || fabricColor || s(row.role));
        if (!hasAny) return;

        const finalName = fabricName || fabricCode;
        if (!finalName) throw new Error("Fabric name is required in fabrics[]");

        out.push({
          fabricName: finalName,
          fabricCode: fabricCode || "",
          fabricColor: fabricColor || "",
          role,
        });
      };

      if (typeof v === "string") {
        const t = v.trim();
        if (!t) return [];
        try {
          v = JSON.parse(t);
        } catch {
          (t.includes("|") ? t.split("|") : t.split(",")).forEach((p) =>
            push(String(p || ""))
          );
          return out;
        }
      }

      if (Array.isArray(v)) return v.forEach(push), out;

      if (v && typeof v === "object") {
        const looksSingle =
          "fabricName" in v || "fabricCode" in v || "fabricColor" in v || "role" in v;

        if (looksSingle) return push(v), out;

        Object.entries(v).forEach(([role, name]) =>
          push({ role, fabricName: name })
        );
        return out;
      }

      return [];
    };

    /* ---------------- normalize (only if provided) ---------------- */
    if (data.attributes !== undefined) data.attributes = json(data.attributes, data.attributes);

    if (data.shortDescription !== undefined) data.shortDescription = s(data.shortDescription);
    if (data.howToStyle !== undefined) data.howToStyle = s(data.howToStyle);
    if (data.fabricDetails !== undefined) data.fabricDetails = s(data.fabricDetails);

    if (data.keyFeatures !== undefined) data.keyFeatures = json(data.keyFeatures, []);
    else if (data.highlights !== undefined) data.keyFeatures = json(data.highlights, []);
    if (data.highlights !== undefined) delete data.highlights;

    if (data.specifications !== undefined || data.specs !== undefined) {
      data.specifications = normSpecs(data.specifications ?? data.specs);
      delete data.specs;
    }

    if (data.keywords !== undefined) data.keywords = arr(data.keywords);
    if (data.tags !== undefined) data.tags = tagsNorm(data.tags);
    if (data.collections !== undefined) data.collections = arr(data.collections);

    if (data.fabrics !== undefined) {
      try {
        data.fabrics = normFabrics(json(data.fabrics, data.fabrics));
      } catch (err) {
        return res.status(400).json({ message: err.message || "Invalid fabrics" });
      }
    }

    if (data.avgFabricConsumption !== undefined) {
      data.avgFabricConsumption = json(data.avgFabricConsumption, data.avgFabricConsumption);
    }

    // ✅ NEW fields
    if (data.originalProductLink !== undefined) data.originalProductLink = s(data.originalProductLink);
    if (data.productLink !== undefined && data.originalProductLink === undefined) {
      data.originalProductLink = s(data.productLink);
      delete data.productLink;
    }

    // allow manual set, but we will recompute if variants provided
    if (data.isPatternReady !== undefined) data.isPatternReady = toBool(data.isPatternReady);

    if (data.isSamplingDone !== undefined) data.isSamplingDone = toBool(data.isSamplingDone);
    if (data.isBestSeller !== undefined) data.isBestSeller = toBool(data.isBestSeller);
    if (data.isTrending !== undefined) data.isTrending = toBool(data.isTrending);
if (data.availableForCollab !== undefined) {
  data.availableForCollab = toBool(data.availableForCollab);
}
    // ✅ NEW
    if (data.isPrimaryProduct !== undefined) {
      data.isPrimaryProduct = toBool(data.isPrimaryProduct);
    }

    if (data.colors !== undefined) data.colors = normColors(data.colors);

    if (data.hsnCode !== undefined) {
      const hsn = s(data.hsnCode);
      if (hsn && !/^\d+$/.test(hsn)) {
        return res.status(400).json({ message: "HSN code must contain digits only" });
      }
      data.hsnCode = hsn;
    }

    /* ---------------- fetch existing ---------------- */
    const existing = await Product.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Product not found" });

    /* ---------------- slug ---------------- */
    if (data.slug || data.title) {
      const nextSlug = slugify(String(data.slug || data.title || existing.title), { lower: true });
      if (nextSlug !== existing.slug) {
        const clash = await Product.exists({ slug: nextSlug, _id: { $ne: existing._id } });
        if (clash) return res.status(400).json({ message: "Slug already exists" });
        data.slug = nextSlug;
      }
    }

    /* ---------------- categories ---------------- */
    if (data.categories !== undefined) {
      const raw = Array.isArray(data.categories)
        ? data.categories
        : typeof data.categories === "string"
        ? data.categories.split(",").map((c) => s(c)).filter(Boolean)
        : [];

      const hadNewArrivals = raw.some((c) => String(c).toLowerCase() === "new-arrivals");
      const filtered = raw.filter((c) => !SYSTEM_CATEGORIES.has(String(c).toLowerCase()));

      if (!filtered.length) {
        return res.status(400).json({
          message:
            "Select a main category like dress/top/shirt etc (all-clothing/new-arrivals are not allowed as main category)",
        });
      }

      data.categories = filtered;

      if (hadNewArrivals) {
        const baseTags = tagsNorm(data.tags ?? existing.tags);
        data.tags = Array.from(new Set([...baseTags, "new-arrival"]));
      }
    }

    /* ---------------- validate attributes ---------------- */
    await validateAttributes(data.attributes ?? existing.attributes);

    if (Array.isArray(data.variants)) data.variants = data.variants.map(({ image, ...v }) => v);

    // ✅ never accept product stock update here
    delete data.stock;
    delete data.isInStock;

    /* ---------------- variants (preserve inventory) ---------------- */
    if (Array.isArray(data.variants)) {
      const existingById = new Map((existing.variants || []).map((v) => [String(v._id), v]));

      data.variants = keepOnlySizeVariants(
        data.variants.map((v) => {
          const prev = v?._id ? existingById.get(String(v._id)) : null;
          return {
            ...(v._id ? { _id: v._id } : {}),
            sku: v.sku,
            barcode: v.barcode ?? "",
            weight: typeof v.weight === "number" ? v.weight : 0,
            patternNumber: s(v?.patternNumber || ""),
            stock: prev?.stock ?? 0,
            reservedStock: prev?.reservedStock ?? 0,
            isInStock: prev?.isInStock ?? false,
            attributes: Array.isArray(v.attributes) ? v.attributes : [],
          };
        })
      );

      data.productType = data.variants.length ? "variable" : "simple";

      // ✅ AUTO set isPatternReady if variants changed
      data.isPatternReady = data.variants.some(
        (v) => v?.patternNumber && String(v.patternNumber).trim()
      );
    } else {
      delete data.variants;
    }

    /* ---------------- cross-sell ---------------- */
    if (data.crossSellProducts !== undefined) {
      const raw = Array.isArray(data.crossSellProducts)
        ? data.crossSellProducts
        : typeof data.crossSellProducts === "string"
        ? data.crossSellProducts.split(",").map((id) => s(id))
        : [];

      data.crossSellProducts = raw
        .filter(isValidObjectId)
        .filter((id) => String(id) !== String(existing._id));
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
    delete data.keepImages;

    /* ---------------- SKU handling ---------------- */
    const skuData = {
      ...existing.toObject(),
      ...data,
      variants: Array.isArray(data.variants) ? data.variants : existing.variants,
    };

    await ensureSKUs(skuData);
    data.sku = skuData.sku;
    if (Array.isArray(data.variants)) data.variants = skuData.variants;

    // ✅ FINAL SAFETY: compute pattern ready from final variants (if variable)
    const finalVariants = Array.isArray(data.variants) ? data.variants : existing.variants;
    const finalIsPatternReady =
      Array.isArray(finalVariants) &&
      finalVariants.some((v) => v?.patternNumber && String(v.patternNumber).trim());

    if (data.isPatternReady === undefined) data.isPatternReady = !!finalIsPatternReady;

    /* ---------------- apply + save ---------------- */
    existing.set(data);

    [
      "variants",
      "attributes",
      "fabrics",
      "avgFabricConsumption",
      "images",
      "colors",
      "isSamplingDone",
      "isBestSeller",
      "isTrending",
      "availableForCollab",
      "isPatternReady",
      "isPrimaryProduct",
      "originalProductLink",
      "keyFeatures",
      "shortDescription",
      "howToStyle",
      "fabricDetails",
      "specifications",
      "categories",
      "tags",
      "collections",
      "keywords",
      "crossSellProducts",
      "thumbnail",
      "sku",
      "hsnCode",
      "slug",
      "productType",
    ].forEach((k) => data[k] !== undefined && existing.markModified(k));

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

    return res.json({
      message: "Product updated successfully",
      product: applyStockFromVariants(updated),
    });
  } catch (e) {
    console.error("❌ Update Product Error:", e);
    return res.status(500).json({ message: e.message });
  }
};

export const updateVariantPatternNumber = async (req, res) => {
  try {
    const { variantId, patternNumber } = req.body;

    if (!variantId) return res.status(400).json({ message: "variantId required" });

    const pn = String(patternNumber || "").trim();

    const updated = await Product.findOneAndUpdate(
      { _id: req.params.id, "variants._id": variantId },
      { $set: { "variants.$.patternNumber": pn } },
      { new: true }
    ).populate([
      { path: "collections" },
      { path: "offer" },
      { path: "couponsApplicable" },
      { path: "reviews" },
      { path: "crossSellProducts" },
      { path: "attributes.attribute" },
      { path: "variants.attributes.attribute" },
    ]);

    if (!updated) return res.status(404).json({ message: "Product/Variant not found" });

    return res.json({
      message: "Variant pattern updated",
      product: applyStockFromVariants(updated),
    });
  } catch (e) {
    console.error("❌ updateVariantPatternNumber:", e);
    res.status(500).json({ message: e.message });
  }
};

/* ============================================================
   SYNC PRODUCT ASSOCIATION GROUP
   - All selected products become cross-sells of each other
   - Same pattern number is applied to all variants
============================================================ */
export const syncProductAssociationGroup = async (req, res) => {
  try {
    const sourceId = String(req.params.id || "").trim();

    const rawIds =
      req.body?.productIds ??
      req.body?.crossSellProducts ??
      req.body?.associatedProductIds ??
      [];

    const patternNumber = String(req.body?.patternNumber || "").trim();

    if (!mongoose.Types.ObjectId.isValid(sourceId)) {
      return res.status(400).json({
        message: "Invalid source product ID",
      });
    }

    const selectedIds = (
      Array.isArray(rawIds)
        ? rawIds
        : String(rawIds || "")
            .split(",")
            .map((id) => id.trim())
    )
      .map((item) =>
        item && typeof item === "object" && item._id
          ? String(item._id)
          : String(item || "").trim()
      )
      .filter(
        (id) =>
          mongoose.Types.ObjectId.isValid(id) &&
          String(id) !== String(sourceId)
      );

    const groupIds = Array.from(new Set([sourceId, ...selectedIds]));

    if (groupIds.length < 2) {
      return res.status(400).json({
        message: "Select at least one product to associate",
      });
    }

    const products = await Product.find({
      _id: { $in: groupIds },
    }).select("_id title productCode variants crossSellProducts");

    if (products.length !== groupIds.length) {
      const foundIds = new Set(
        products.map((product) => String(product._id))
      );

      const missingIds = groupIds.filter(
        (id) => !foundIds.has(String(id))
      );

      return res.status(404).json({
        message: "Some selected products were not found",
        missingIds,
      });
    }

    const operations = products.map((product) => {
      const productId = String(product._id);

      const crossSellProducts = groupIds.filter(
        (id) => String(id) !== productId
      );

      return {
        updateOne: {
          filter: { _id: product._id },
          update: {
            $set: {
              crossSellProducts,
              "variants.$[].patternNumber": patternNumber,
              isPatternReady: Boolean(patternNumber),
            },
          },
        },
      };
    });

    await Product.bulkWrite(operations);

    const updatedProducts = await Product.find({
      _id: { $in: groupIds },
    })
      .select(
        "title slug productCode thumbnail price compareAtPrice variants crossSellProducts isPatternReady"
      )
      .populate({
        path: "crossSellProducts",
        select:
          "title slug productCode thumbnail price compareAtPrice isActive",
      });

    return res.json({
      message: "Products associated successfully",
      patternNumber,
      totalProducts: updatedProducts.length,
      products: updatedProducts.map(applyStockFromVariants),
    });
  } catch (e) {
    console.error("❌ syncProductAssociationGroup:", e);

    return res.status(500).json({
      message: e.message || "Unable to associate products",
    });
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

// PATCH /api/products/:id/variant-stock  { size: "M", stock: 5 }
// ✅ Only for VARIABLE products
// PATCH /api/products/:id/variant-stock  { size: "M", stock: 5 }
// ✅ Only for VARIABLE products
export const updateVariantStock = async (req, res) => {
  try {
    const { size, stock } = req.body;

    const sz = String(size || "").trim();
    if (!sz) {
      return res.status(400).json({ message: "size is required (e.g., 'M')" });
    }

    const st = Number(stock);
    if (!Number.isFinite(st) || st < 0) {
      return res
        .status(400)
        .json({ message: "Invalid stock. Provide a non-negative number." });
    }

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const isVariable =
      product.productType === "variable" ||
      (Array.isArray(product.variants) && product.variants.length > 0);

    if (!isVariable) {
      return res.status(400).json({
        message:
          "This is a simple product. Use PATCH /api/products/:id/stock with { stock }.",
      });
    }

    const targetSize = normalizeSize(sz);

    const variant =
      (product.variants || []).find(
        (v) => normalizeSize(getVariantSize(v)) === targetSize
      ) || null;

    if (!variant) {
      return res.status(404).json({
        message: `Variant not found for size: ${targetSize}`,
      });
    }

    const variantId = variant._id;

    // ✅ ACTUAL UPDATE (THIS WAS MISSING)
    variant.stock = st;

    // ✅ IMPORTANT: tell mongoose variants array changed (safe)
    product.markModified("variants");

    // ✅ recompute product totals (physical totals)
    const totalStock = (product.variants || []).reduce(
      (sum, v) => sum + Number(v?.stock ?? 0),
      0
    );

    product.stock = totalStock;

    await product.save({ validateBeforeSave: true });

    // ✅ AFTER stock update: (optional) reconcile backorders
    let reconcileSummary = null;
    try {
      reconcileSummary = await reconcileBackordersForVariant({
        productId: product._id,
        variantId,
      });
    } catch (reErr) {
      console.error(
        "⚠️ reconcileBackordersForVariant failed:",
        reErr?.message || reErr
      );
    }

    const full = await pop(Product.findById(product._id));

    return res.json({
      message: "Variant stock updated",
      product: applyStockFromVariants(full),
      updated: { size: targetSize, stock: st },
      reconcile: reconcileSummary,
    });
  } catch (e) {
    console.error("❌ updateVariantStock Error:", e);
    return res.status(500).json({ message: e.message });
  }
};

export const updateProductColors = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    // colorsJson can be JSON string or array
    const raw = req.body?.colorsJson;
    const parsed =
      typeof raw === "string"
        ? (() => { try { return JSON.parse(raw); } catch { return null; } })()
        : raw;

    if (!Array.isArray(parsed)) {
      return res.status(400).json({ message: "colorsJson must be a JSON array" });
    }

    // multer files (array)
    const files = Array.isArray(req.files?.swatchImages) ? req.files.swatchImages : [];

    const normalizeName = (v) => String(v || "").trim().toLowerCase();
    const normalizeHex = (v) => {
      const s = String(v || "").trim();
      if (!s) return "";
      return /^#([0-9a-fA-F]{3}){1,2}$/.test(s) ? s : "";
    };

    // Build swatches (keep order)
    const swatches = [];
    const seen = new Set();

    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i] || {};
      const name = normalizeName(item.name);
      const hex = normalizeHex(item.hex);
      const existingUrl = String(item.image || "").trim();

      if (!name) continue; // skip empty rows

      if (seen.has(name)) {
        return res.status(400).json({ message: `Duplicate color: ${name}` });
      }
      seen.add(name);

      // If a file exists at same index -> upload it
      let imageUrl = existingUrl;
      if (files[i]) {
        const uploaded = await uploadFile(files[i], "product-color-swatches");
        imageUrl = uploaded || "";
      }

      swatches.push({ name, hex, image: imageUrl });
    }

    // Save swatches + keep colors array in sync
    product.colorSwatches = swatches;
    product.colors = swatches.map((s) => s.name);

    product.markModified("colorSwatches");
    product.markModified("colors");

    const saved = await product.save({ validateBeforeSave: true });
    const full = await pop(Product.findById(saved._id));

    return res.json({
      message: "Product colors updated",
      product: applyStockFromVariants(full),
    });
  } catch (e) {
    console.error("❌ updateProductColors Error:", e);
    return res.status(500).json({ message: e.message });
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
      q,
      title,
      productCode,
      code,
      card,
    } = req.query;

    const categoryParam = String(req.params.category || "").trim();

    if (!categoryParam) {
      return res.status(400).json({ message: "Category is required" });
    }

    /* ---------------- category: slug / id / name ---------------- */
    let catDoc = null;

    if (mongoose.Types.ObjectId.isValid(categoryParam)) {
      catDoc = await Category.findById(categoryParam).lean();
    }

    if (!catDoc) {
      catDoc = await Category.findOne({
        $or: [
          { slug: categoryParam.toLowerCase() },
          { name: { $regex: `^${escapeRegex(categoryParam)}$`, $options: "i" } },
        ],
      }).lean();
    }

    const categoryMatch = catDoc
      ? [catDoc.slug, catDoc.name].filter(Boolean)
      : [categoryParam];

    const filters = {
      categories: { $in: categoryMatch },
    };

    /* ---------------- collections ---------------- */
    if (collection) {
      filters.collections = await resolveCollectionFilter(collection);
    }

    /* ---------------- tags ---------------- */
    const normalizedTags = tagsNorm(tags);
    if (normalizedTags.length) {
      filters.tags = { $in: normalizedTags };
    }

    /* ---------------- active ---------------- */
    if (isActive !== undefined) {
      filters.isActive = String(isActive).toLowerCase() === "true";
    }

    /* ---------------- sku ---------------- */
    if (sku) {
      filters.$or = [
        { sku: String(sku).trim() },
        { "variants.sku": String(sku).trim() },
      ];
    }

    /* ---------------- product code search ---------------- */
    applyProductCodeFilter(filters, { q, title, productCode, code, search });

    /* ---------------- price ---------------- */
    if (minPrice || maxPrice) {
      filters.price = {};

      if (minPrice) filters.price.$gte = Number(minPrice);
      if (maxPrice) filters.price.$lte = Number(maxPrice);
    }

    /* ---------------- text search ---------------- */
    const qStr = String(q ?? "").trim();
    const titleStr = String(title ?? "").trim();
    const searchStr = String(search ?? "").trim();

    const searchText =
      searchStr ||
      (/^\d+$/.test(qStr) ? "" : qStr) ||
      (/^\d+$/.test(titleStr) ? "" : titleStr);

    if (searchText) {
      filters.$text = { $search: searchText };
    }

    /* ---------------- sorting ---------------- */
    const sortMap = {
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      newest: { createdAt: -1 },
      rating: { averageRating: -1 },
      popularity: { "analytics.views": -1 },
    };

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 20));
    const skip = (safePage - 1) * safeLimit;
    const sortObj = sortMap[sort] || { createdAt: -1 };

    const docs = await pop(Product.find(filters))
      .sort(sortObj)
      .skip(skip)
      .limit(safeLimit);

    const total = await Product.countDocuments(filters);

    const useCard = ["1", "true", "yes"].includes(
      String(card || "").toLowerCase()
    );

    const products = useCard
      ? (docs || []).map((doc) =>
          mapProductCard(doc?.toObject ? doc.toObject() : doc)
        )
      : (docs || []).map(applyStockFromVariants);

    return res.json({
      category: catDoc
        ? { _id: catDoc._id, name: catDoc.name, slug: catDoc.slug }
        : { raw: categoryParam },

      total,
      page: safePage,
      pages: Math.ceil(total / safeLimit),
      products,
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

      // ✅ NEW (optional)
      q,
      title,
      productCode,
      code,
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

    /* ---------------- SKU (exact) ---------------- */
    if (sku) {
      filters.$or = [
        { sku: String(sku) },
        { "variants.sku": String(sku) },
      ];
    }

    /* ---------------- ✅ PRODUCT CODE SEARCH (NEW) ----------------
       Works with:
       ?productCode=00336  OR ?code=00336  OR ?q=336  OR ?title=336
       Matches:
       - productCode exact
       - sku / variants.sku contains code (CAT-00336-XS)
    --------------------------------------------------------------- */
    applyProductCodeFilter(filters, { q, title, productCode, code });

    /* ---------------- price ---------------- */
    if (minPrice || maxPrice) {
      filters.price = {};
      if (minPrice) filters.price.$gte = Number(minPrice);
      if (maxPrice) filters.price.$lte = Number(maxPrice);
    }

    /* ---------------- search ($text) ----------------
       - keep explicit search
       - fallback from q/title when they are NOT numeric
    -------------------------------------------------- */
    const qStr = String(q ?? "").trim();
    const titleStr = String(title ?? "").trim();
    const searchText =
      String(search ?? "").trim() ||
      (/^\d+$/.test(qStr) ? "" : qStr) ||
      (/^\d+$/.test(titleStr) ? "" : titleStr);

    if (searchText) {
      filters.$text = { $search: searchText };
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
   ✅ GET PRODUCTS BY COLLECTION - OPTIMIZED FOR PRODUCT CARD
   GET /api/products/by-collection/:collection
   Example:
   /api/products/by-collection/budget-bees?page=1&limit=100&sort=newest
============================================================ */
export const getProductsByCollection = async (req, res) => {
  try {
    const { collection } = req.params;

    const {
      page = 1,
      limit = 100,

      // filters
      category,
      tags,
      minPrice,
      maxPrice,
      isActive = "true",
      isDraft = "false",
      isBestSeller,
      isTrending,
      isPrimaryProduct,
      isInStock,
      search,
      q,
      productCode,
      code,

      // sorting
      sort = "newest",
    } = req.query;

    const raw = String(collection || "").trim();

    if (!raw) {
      return res.status(400).json({ message: "Collection is required" });
    }

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 100));
    const skip = (safePage - 1) * safeLimit;

    const toStr = (v) => String(v ?? "").trim();
    const hasVal = (v) =>
      v !== undefined && v !== null && String(v).trim() !== "";

    const toBool = (v) => String(v).trim().toLowerCase() === "true";

    const toArray = (v) => {
      if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);

      return String(v ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    };

    /* ---------------- resolve collection ---------------- */
    const collectionDoc = await Collection.findOne({
      $or: [
        mongoose.Types.ObjectId.isValid(raw) ? { _id: raw } : null,
        { slug: raw.toLowerCase() },
        { name: { $regex: `^${escapeRegex(raw)}$`, $options: "i" } },
      ].filter(Boolean),
    })
      .select("_id name slug description bannerImage thumbnailImage isActive")
      .lean();

    if (!collectionDoc) {
      return res.status(404).json({ message: "Collection not found" });
    }

    /* ---------------- filters ---------------- */
    const filters = {
      collections: collectionDoc._id,
    };

    if (hasVal(isActive)) filters.isActive = toBool(isActive);
    if (hasVal(isDraft)) filters.isDraft = toBool(isDraft);
    if (hasVal(isBestSeller)) filters.isBestSeller = toBool(isBestSeller);
    if (hasVal(isTrending)) filters.isTrending = toBool(isTrending);
    if (hasVal(isPrimaryProduct)) {
      filters.isPrimaryProduct = toBool(isPrimaryProduct);
    }
    if (hasVal(isInStock)) filters.isInStock = toBool(isInStock);

    if (hasVal(category)) {
      const cats = toArray(category);
      if (cats.length) filters.categories = { $in: cats };
    }

    const normalizedTags = tagsNorm(tags);
    if (normalizedTags.length) {
      filters.tags = { $in: normalizedTags };
    }

    if (hasVal(minPrice) || hasVal(maxPrice)) {
      filters.price = {};

      if (hasVal(minPrice)) filters.price.$gte = Number(minPrice);
      if (hasVal(maxPrice)) filters.price.$lte = Number(maxPrice);
    }

    /* ---------------- product code filter ---------------- */
    applyProductCodeFilter(filters, {
      q,
      search,
      productCode,
      code,
    });

    /* ---------------- text search ---------------- */
    const searchText = toStr(search || q);

    if (searchText && !isDigitsOnly(searchText)) {
      const rx = {
        $regex: escapeRegex(searchText),
        $options: "i",
      };

      filters.$or = [
        ...(Array.isArray(filters.$or) ? filters.$or : []),
        { title: rx },
        { slug: rx },
        { productCode: rx },
        { tags: rx },
        { categories: rx },
      ];
    }

    /* ---------------- sorting ---------------- */
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      popularity: { "analytics.views": -1 },
      rating: { averageRating: -1 },
      title_asc: { title: 1 },
      title_desc: { title: -1 },
    };

    const sortObj = sortMap[sort] || sortMap.newest;

    /* ---------------- only ProductCard required fields ---------------- */
    const cardFields = [
      "title",
      "slug",
      "productCode",
      "price",
      "compareAtPrice",
      "thumbnail",
      "images",
      "categories",
      "isBestSeller",
      "isTrending",
      "isPrimaryProduct",
      "isActive",
      "isDraft",
      "isInStock",
      "createdAt",
    ].join(" ");

    const [docs, total] = await Promise.all([
      Product.find(filters)
        .select(cardFields)
        .sort(sortObj)
        .skip(skip)
        .limit(safeLimit)
        .lean(),

      Product.countDocuments(filters),
    ]);

    return res.json({
      collection: collectionDoc,
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit),
      hasMore: safePage * safeLimit < total,
      products: docs.map(mapProductCard),
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



export const getProductsBySelectedCodes = async (req, res) => {
  try {
    const normalizeCode = (value) => {
      const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
      if (!raw) return "";
      if (/^\d+$/.test(raw)) return raw.padStart(5, "0");
      return raw;
    };

    let codes =
      req.body?.selectedProductCodes ??
      req.body?.productCodes ??
      req.body?.codes ??
      req.query?.selectedProductCodes ??
      req.query?.productCodes ??
      req.query?.codes;

    codes = Array.isArray(codes)
      ? codes
      : typeof codes === "string"
        ? codes.split(",")
        : [];

    const normalizedCodes = [
      ...new Set(codes.map(normalizeCode).filter(Boolean)),
    ];

    if (!normalizedCodes.length) {
      return res.status(400).json({
        success: false,
        message: "selectedProductCodes is required",
      });
    }

    const docs = await pop(
      Product.find({
        productCode: { $in: normalizedCodes },
      })
    ).lean();

    const productMap = new Map();
    docs.forEach((product) => {
      const code = normalizeCode(product?.productCode);
      if (code && !productMap.has(code)) {
        productMap.set(code, applyStockFromVariants(product));
      }
    });

    const products = normalizedCodes
      .map((code) => productMap.get(code))
      .filter(Boolean);

    const missingCodes = normalizedCodes.filter((code) => !productMap.has(code));

    return res.json({
      success: true,
      requestedCount: normalizedCodes.length,
      foundCount: products.length,
      missingCount: missingCodes.length,
      missingCodes,
      products,
    });
  } catch (e) {
    console.error("❌ getProductsBySelectedCodes error:", e);
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to fetch selected products",
    });
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


// PATCH /api/products/:id/stock  { stock: number }
// ✅ Only for SIMPLE products
// PATCH /api/products/:id/stock  { stock: number }
// ✅ Only for SIMPLE products
export const updateProductStock = async (req, res) => {
  try {
    const { stock } = req.body;

    const st = Number(stock);
    if (!Number.isFinite(st) || st < 0) {
      return res
        .status(400)
        .json({ message: "Invalid stock. Provide a non-negative number." });
    }

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const isVariable =
      product.productType === "variable" ||
      (Array.isArray(product.variants) && product.variants.length > 0);

    // ✅ Rule enforcement
    if (isVariable) {
      return res.status(400).json({
        message:
          "This is a variable product. Use PATCH /api/products/:id/variant-stock with { size, stock }.",
      });
    }

    // ✅ update physical stock
    product.stock = st;

    // ✅ inStock = stock > 0 (reservation model is source of truth)
    // product.isInStock = st > 0;

    // ✅ DO NOT auto-unpublish
    // if (!product.isInStock) product.isActive = false;

    await product.save({ validateBeforeSave: true });

    const full = await pop(Product.findById(product._id));

    return res.json({
      message: "Product stock updated",
      product: applyStockFromVariants(full),
      updated: { stock: st },
    });
  } catch (e) {
    console.error("❌ updateProductStock Error:", e);
    return res.status(500).json({ message: e.message });
  }
};



// PATCH /api/products/:id/best-seller
// Body optional:
// - { isBestSeller: true/false } -> direct set
// - empty body -> toggle current value
export const toggleBestSeller = async (req, res) => {
  try {
    const { id } = req.params;

    const toBool = (v) => {
      if (typeof v === "boolean") return v;
      const s = String(v ?? "").trim().toLowerCase();
      return s === "true" || s === "1" || s === "yes";
    };

    const exists = await Product.findById(id);
    if (!exists) return res.status(404).json({ message: "Product not found" });

    let nextVal;
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "isBestSeller")) {
      nextVal = toBool(req.body.isBestSeller);
    } else {
      nextVal = !Boolean(exists.isBestSeller);
    }

    const updated = await pop(
      Product.findByIdAndUpdate(
        id,
        { $set: { isBestSeller: nextVal } },
        { new: true, runValidators: true }
      )
    );

    return res.json({
      message: `Best Seller ${nextVal ? "enabled" : "disabled"}`,
      isBestSeller: nextVal,
      product: applyStockFromVariants(updated),
    });
  } catch (e) {
    console.error("❌ toggleBestSeller Error:", e);
    return res.status(500).json({ message: e.message });
  }
};


// Mark Product Pattern Ready (Manual Override)
export const markPatternReady = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    product.isPatternReady = true;

    await product.save({ validateBeforeSave: false });

    return res.json({
      message: "Product marked as Pattern Ready",
      product,
    });
  } catch (error) {
    console.error("❌ Mark Pattern Ready Error:", error);
    return res.status(500).json({ message: error.message });
  }
};



// controllers/productController.js

// PATCH /api/products/inventory/zero-all
// Optional body:
// {
//   "clearReservedStock": true
// }
export const zeroAllVariantStock = async (req, res) => {
  try {
    const clearReservedStock =
      req.body?.clearReservedStock === true ||
      String(req.body?.clearReservedStock || "").trim().toLowerCase() === "true";

    const BATCH_SIZE = 500;

    let totalMatched = 0;
    let totalModified = 0;
    let simpleCount = 0;
    let variableCount = 0;

    const cursor = Product.find(
      {},
      {
        _id: 1,
        stock: 1,
        reservedStock: 1,
        isInStock: 1,
        variants: 1,
        productType: 1,
      }
    )
      .lean()
      .cursor();

    let ops = [];

    const flush = async () => {
      if (!ops.length) return;

      const result = await Product.bulkWrite(ops, { ordered: false });
      totalMatched += result.matchedCount || 0;
      totalModified += result.modifiedCount || 0;
      ops = [];
    };

    for await (const product of cursor) {
      const variants = Array.isArray(product.variants) ? product.variants : [];
      const isVariable =
        product.productType === "variable" || variants.length > 0;

      if (isVariable) variableCount += 1;
      else simpleCount += 1;

      const nextVariants = variants.map((v) => ({
        ...v,
        stock: 0,
        isInStock: false,
        ...(clearReservedStock ? { reservedStock: 0 } : {}),
      }));

      ops.push({
        updateOne: {
          filter: { _id: product._id },
          update: {
            $set: {
              stock: 0,
              isInStock: false,
              variants: nextVariants,
              ...(clearReservedStock ? { reservedStock: 0 } : {}),
            },
          },
        },
      });

      if (ops.length >= BATCH_SIZE) {
        await flush();
      }
    }

    await flush();

    return res.json({
      message: "All product inventory marked as 0 successfully",
      clearReservedStock,
      matchedCount: totalMatched,
      modifiedCount: totalModified,
      simpleProducts: simpleCount,
      variableProducts: variableCount,
    });
  } catch (e) {
    console.error("❌ zeroAllProductsInventory Error:", e);
    return res.status(500).json({ message: e.message });
  }
};


// PATCH /api/products/:id/trending
// Body optional:
// - { isTrending: true/false } -> direct set
// - empty body -> toggle current value
export const toggleTrending = async (req, res) => {
  try {
    const { id } = req.params;

    const toBool = (v) => {
      if (typeof v === "boolean") return v;
      const s = String(v ?? "").trim().toLowerCase();
      return s === "true" || s === "1" || s === "yes";
    };

    const exists = await Product.findById(id);
    if (!exists) return res.status(404).json({ message: "Product not found" });

    let nextVal;
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "isTrending")) {
      nextVal = toBool(req.body.isTrending);
    } else {
      nextVal = !Boolean(exists.isTrending);
    }

    const updated = await pop(
      Product.findByIdAndUpdate(
        id,
        { $set: { isTrending: nextVal } },
        { new: true, runValidators: true }
      )
    );

    return res.json({
      message: `Trending ${nextVal ? "enabled" : "disabled"}`,
      isTrending: nextVal,
      product: applyStockFromVariants(updated),
    });
  } catch (e) {
    console.error("❌ toggleTrending Error:", e);
    return res.status(500).json({ message: e.message });
  }
};




// PATCH /api/products/bulk/trending/by-codes
// Body:
// {
//   "codes": ["00229", "00230", "00311"]
//   "isTrending": true
// }
//
// also supports:
// {
//   "codes": "00229,00230,00311",
//   "isTrending": false
// }
export const bulkMarkTrendingByCodes = async (req, res) => {
  try {
    const toBool = (v) => {
      if (typeof v === "boolean") return v;
      const s = String(v ?? "").trim().toLowerCase();
      return s === "true" || s === "1" || s === "yes";
    };

    let { codes, isTrending } = req.body;

    codes = Array.isArray(codes)
      ? codes
      : typeof codes === "string"
        ? codes.split(",").map((x) => String(x).trim()).filter(Boolean)
        : [];

    codes = [...new Set(codes.map((c) => String(c).trim()).filter(Boolean))];

    if (!codes.length) {
      return res.status(400).json({ message: "codes is required" });
    }

    if (isTrending === undefined) {
      return res.status(400).json({ message: "isTrending is required" });
    }

    const nextVal = toBool(isTrending);

    const existing = await Product.find(
      { productCode: { $in: codes } },
      { _id: 1, productCode: 1, title: 1, isTrending: 1 }
    ).lean();

    const foundCodes = existing.map((p) => String(p.productCode));
    const missingCodes = codes.filter((c) => !foundCodes.includes(String(c)));

    const result = await Product.updateMany(
      { productCode: { $in: codes } },
      { $set: { isTrending: nextVal } }
    );

    const updatedProducts = await pop(
      Product.find({ productCode: { $in: foundCodes } }).sort({ createdAt: -1 })
    );

    const orderMap = new Map(
      updatedProducts.map((p) => [String(p.productCode), p])
    );

    const orderedProducts = foundCodes
      .map((code) => orderMap.get(String(code)))
      .filter(Boolean)
      .map(applyStockFromVariants);

    return res.json({
      message: `Trending ${nextVal ? "enabled" : "disabled"} for selected product codes`,
      isTrending: nextVal,
      requestedCount: codes.length,
      foundCount: foundCodes.length,
      missingCount: missingCodes.length,
      matchedCount: result.matchedCount || 0,
      modifiedCount: result.modifiedCount || 0,
      foundCodes,
      missingCodes,
      products: orderedProducts,
    });
  } catch (e) {
    console.error("❌ bulkMarkTrendingByCodes Error:", e);
    return res.status(500).json({ message: e.message });
  }
};



export const updatePrimaryProductStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isPrimaryProduct, productCode, productCodes, ids } = req.body;

    if (typeof isPrimaryProduct === "undefined") {
      return res.status(400).json({ message: "isPrimaryProduct is required" });
    }

    const toBool = (v) =>
      typeof v === "boolean"
        ? v
        : ["true", "1", "yes"].includes(String(v).trim().toLowerCase());

    const nextValue = toBool(isPrimaryProduct);

    const codeList = [
      ...(productCode ? [productCode] : []),
      ...(Array.isArray(productCodes) ? productCodes : []),
    ]
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    const idList = [
      ...(id ? [id] : []),
      ...(Array.isArray(ids) ? ids : []),
    ].filter((x) => mongoose.Types.ObjectId.isValid(String(x)));

    const filter = {};

    if (codeList.length) {
      filter.productCode = { $in: codeList };
    } else if (idList.length) {
      filter._id = { $in: idList };
    } else {
      return res.status(400).json({
        message: "Provide id, ids, productCode, or productCodes",
      });
    }

    const result = await Product.updateMany(
      filter,
      { $set: { isPrimaryProduct: nextValue } },
      { runValidators: true }
    );

    const products = await Product.find(filter);

    if (!products.length) {
      return res.status(404).json({ message: "Product(s) not found" });
    }

    return res.json({
      message: `Product(s) marked as ${nextValue ? "primary" : "secondary"} successfully`,
      updatedCount: result.modifiedCount ?? products.length,
      matchedCount: result.matchedCount ?? products.length,
      products: products.map(applyStockFromVariants),
    });
  } catch (e) {
    console.error("❌ Update Primary Product Status Error:", e);
    return res.status(500).json({ message: e.message });
  }
};


/* ============================================================
   ✅ GET PRODUCT CARDS (LIGHTWEIGHT)
   GET /api/products/cards
   GET /api/products/cards?ids=id1,id2,00218,218
============================================================ */
export const getProductCards = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      ids,
      category,
      collection,
      tags,
      minPrice,
      maxPrice,
      isActive = "true",
      isDraft = "false",
      isBestSeller,
      isTrending,
      isPrimaryProduct,
      search,
      sort,
      sku,

      // optional aliases
      q,
      title,
      productCode,
      code,
    } = req.query;

    const filters = {};
    const toBool = (v) => String(v).trim().toLowerCase() === "true";

    /* ---------------- ids / product codes ---------------- */
    const idList = Array.isArray(ids)
      ? ids
      : typeof ids === "string"
        ? ids.split(",").map((x) => x.trim()).filter(Boolean)
        : [];

    if (idList.length) {
      const objectIds = [];
      const codeCandidatesSet = new Set();

      for (const item of idList) {
        const raw = String(item || "").trim();
        if (!raw) continue;

        if (mongoose.Types.ObjectId.isValid(raw)) {
          objectIds.push(raw);
        }

        buildCodeCandidates(raw).forEach((c) => codeCandidatesSet.add(c));
      }

      const idOr = [];
      if (objectIds.length) idOr.push({ _id: { $in: objectIds } });

      const codeCandidates = Array.from(codeCandidatesSet);
      if (codeCandidates.length) {
        idOr.push({ productCode: { $in: codeCandidates } });
      }

      if (idOr.length) {
        filters.$or = idOr;
      }
    }

    /* ---------------- categories ---------------- */
    if (category) {
      const cats = Array.isArray(category)
        ? category
        : String(category)
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);

      if (cats.length) filters.categories = { $in: cats };
    }

    /* ---------------- collections (slug OR id OR name) ---------------- */
    if (collection) {
      const rawCollections = Array.isArray(collection)
        ? collection
        : String(collection)
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);

      if (rawCollections.length) {
        const objectIds = rawCollections.filter((c) =>
          mongoose.Types.ObjectId.isValid(c)
        );

        const nonIds = rawCollections.filter(
          (c) => !mongoose.Types.ObjectId.isValid(c)
        );

        let matchedCollectionIds = [...objectIds];

        if (nonIds.length) {
          const escaped = nonIds.map((s) =>
            String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          );

          const matchedCollections = await Collection.find({
            $or: [
              { slug: { $in: nonIds.map((s) => String(s).toLowerCase()) } },
              { name: { $in: nonIds } },
              { name: { $in: escaped.map((s) => new RegExp(`^${s}$`, "i")) } },
            ],
          })
            .select("_id slug name")
            .lean();

          matchedCollectionIds.push(
            ...matchedCollections.map((c) => String(c._id))
          );
        }

        matchedCollectionIds = Array.from(
          new Set(matchedCollectionIds.map((x) => String(x)))
        ).filter(Boolean);

        if (!matchedCollectionIds.length) {
          return res.json({
            total: 0,
            page: Math.max(1, Number(page) || 1),
            pages: 0,
            products: [],
          });
        }

        if (matchedCollectionIds.length === 1) {
          filters.collections = matchedCollectionIds[0];
        } else {
          filters.collections = { $in: matchedCollectionIds };
        }
      }
    }

    /* ---------------- tags ---------------- */
    const t = tagsNorm(tags);
    if (t.length) filters.tags = { $in: t };

    /* ---------------- booleans ---------------- */
    if (isActive !== undefined && String(isActive).trim() !== "") {
      filters.isActive = toBool(isActive);
    }

    if (isDraft !== undefined && String(isDraft).trim() !== "") {
      filters.isDraft = toBool(isDraft);
    }

    if (isBestSeller !== undefined && String(isBestSeller).trim() !== "") {
      filters.isBestSeller = toBool(isBestSeller);
    }

    if (isTrending !== undefined && String(isTrending).trim() !== "") {
      filters.isTrending = toBool(isTrending);
    }

    if (
      isPrimaryProduct !== undefined &&
      String(isPrimaryProduct).trim() !== ""
    ) {
      filters.isPrimaryProduct = toBool(isPrimaryProduct);
    }

    /* ---------------- SKU exact ---------------- */
    if (sku) {
      const skuOr = [
        { sku: String(sku) },
        { "variants.sku": String(sku) },
      ];

      if (Array.isArray(filters.$or) && filters.$or.length) {
        filters.$and = [{ $or: filters.$or }, { $or: skuOr }];
        delete filters.$or;
      } else {
        filters.$or = skuOr;
      }
    }

    /* ---------------- productCode search ---------------- */
    if (!idList.length) {
      applyProductCodeFilter(filters, { q, title, productCode, code, search });
    }

    /* ---------------- price ---------------- */
    if (minPrice || maxPrice) {
      filters.price = {};
      if (minPrice) filters.price.$gte = Number(minPrice);
      if (maxPrice) filters.price.$lte = Number(maxPrice);
    }

    /* ---------------- text search ---------------- */
    const qStr = String(q ?? "").trim();
    const titleStr = String(title ?? "").trim();
    const searchStr = String(search ?? "").trim();
    const pcStr = String(productCode ?? "").trim();
    const codeStr = String(code ?? "").trim();

    const isCodeQuery =
      isDigitsOnly(qStr) ||
      isDigitsOnly(titleStr) ||
      isDigitsOnly(searchStr) ||
      isDigitsOnly(pcStr) ||
      isDigitsOnly(codeStr);

    let searchText = "";
    if (!idList.length && !isCodeQuery) {
      searchText = searchStr || qStr || titleStr;
    }

    if (searchText) {
      filters.$text = { $search: searchText };
    }

    /* ---------------- sorting ---------------- */
    const sortMap = {
      price_asc: { price: 1, _id: -1 },
      price_desc: { price: -1, _id: -1 },
      newest: { createdAt: -1, _id: -1 },
      rating: { averageRating: -1, _id: -1 },
      popularity: { "analytics.views": -1, _id: -1 },
    };

    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 20));
    const safePage = Math.max(1, Number(page) || 1);
    const skip = (safePage - 1) * safeLimit;
    const sortObj = sortMap[sort] || { createdAt: -1, _id: -1 };

    const [docs, total] = await Promise.all([
      Product.find(filters)
        .select(
          [
            "title",
            "slug",
            "productCode",
            "categories",
            "price",
            "compareAtPrice",
            "thumbnail",
            "images",
            "isBestSeller",
            "isTrending",
            "isPrimaryProduct",
            "createdAt",
          ].join(" ")
        )
        .sort(sortObj)
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      Product.countDocuments(filters),
    ]);

    let products = (docs || [])
      .map(mapProductCard)
      .filter((p) => p.image && p.price > 0 && p.productCode);

    /* ---------------- keep same order when ids are passed ---------------- */
    if (idList.length) {
      const orderMap = new Map();

      idList.forEach((item, index) => {
        const raw = String(item || "").trim();
        if (!raw) return;

        orderMap.set(raw, index);
        buildCodeCandidates(raw).forEach((c) => {
          if (!orderMap.has(c)) orderMap.set(c, index);
        });
      });

      products = products.sort((a, b) => {
        const aKey1 = String(a?._id || "");
        const aKey2 = String(a?.productCode || "");
        const bKey1 = String(b?._id || "");
        const bKey2 = String(b?.productCode || "");

        const aIdx = orderMap.has(aKey1)
          ? orderMap.get(aKey1)
          : orderMap.has(aKey2)
            ? orderMap.get(aKey2)
            : Number.MAX_SAFE_INTEGER;

        const bIdx = orderMap.has(bKey1)
          ? orderMap.get(bKey1)
          : orderMap.has(bKey2)
            ? orderMap.get(bKey2)
            : Number.MAX_SAFE_INTEGER;

        return aIdx - bIdx;
      });
    }

    return res.json({
      total: idList.length ? products.length : total,
      page: safePage,
      pages: idList.length ? 1 : Math.ceil(total / safeLimit),
      products,
    });
  } catch (e) {
    console.error("❌ Get Product Cards Error:", e);
    return res.status(500).json({ message: e.message });
  }
};

/* ============================================================
   GET ALL PRODUCT MEDIA
   GET /api/products/media/all
============================================================ */
export const getAllProductMedia = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      search = "",
      source = "all",
      type = "all",
      role = "all",
      isActive = "true",
    } = req.query;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));

    const match = {};
    if (isActive !== "all") match.isActive = String(isActive) === "true";

    if (search) {
      const rx = new RegExp(escapeRegex(String(search).trim()), "i");
      match.$or = [
        { title: rx },
        { slug: rx },
        { productCode: rx },
        { images: rx },
        { thumbnail: rx },
        { video: rx },
      ];
    }

    const pipeline = [
      { $match: match },

      {
        $project: {
          title: 1,
          slug: 1,
          productCode: 1,
          isActive: 1,
          createdAt: 1,
          media: {
            $concatArrays: [
              [
                {
                  url: "$thumbnail",
                  role: "thumbnail",
                  position: 0,
                },
              ],
              {
                $map: {
                  input: { $ifNull: ["$images", []] },
                  as: "img",
                  in: {
                    url: "$$img",
                    role: "gallery",
                    position: { $indexOfArray: ["$images", "$$img"] },
                  },
                },
              },
              [
                {
                  url: "$video",
                  role: "video",
                  position: null,
                },
              ],
            ],
          },
        },
      },

      { $unwind: "$media" },

      {
        $match: {
          "media.url": { $type: "string", $ne: "" },
        },
      },

      {
        $addFields: {
          mediaType: {
            $cond: [
              {
                $regexMatch: {
                  input: "$media.url",
                  regex: /\.(mp4|webm|mov|m3u8)(\?|$)/i,
                },
              },
              "video",
              "image",
            ],
          },
          mediaSource: {
            $switch: {
              branches: [
                {
                  case: {
                    $regexMatch: {
                      input: "$media.url",
                      regex: /res\.cloudinary\.com/i,
                    },
                  },
                  then: "cloudinary",
                },
                {
                  case: {
                    $regexMatch: {
                      input: "$media.url",
                      regex: /(oatclub)/i,
                    },
                  },
                  then: "internal",
                },
              ],
              default: "outsourced",
            },
          },
        },
      },

      ...(type !== "all" ? [{ $match: { mediaType: type } }] : []),
      ...(source !== "all" ? [{ $match: { mediaSource: source } }] : []),
      ...(role !== "all" ? [{ $match: { "media.role": role } }] : []),

      { $sort: { createdAt: -1, "media.position": 1 } },

      {
        $facet: {
          data: [
            { $skip: (safePage - 1) * safeLimit },
            { $limit: safeLimit },
            {
              $project: {
                _id: 0,
                url: "$media.url",
                type: "$mediaType",
                source: "$mediaSource",
                role: "$media.role",
                position: "$media.position",
                product: {
                  _id: "$_id",
                  title: "$title",
                  slug: "$slug",
                  productCode: "$productCode",
                  isActive: "$isActive",
                },
              },
            },
          ],
          total: [{ $count: "count" }],
        },
      },
    ];

    const result = await Product.aggregate(pipeline);
    const media = result?.[0]?.data || [];
    const totalMedia = result?.[0]?.total?.[0]?.count || 0;

    return res.json({
      success: true,
      page: safePage,
      limit: safeLimit,
      totalMedia,
      totalPages: Math.ceil(totalMedia / safeLimit),
      hasNextPage: safePage * safeLimit < totalMedia,
      hasPrevPage: safePage > 1,
      filters: { search, source, type, role, isActive },
      media,
    });
  } catch (e) {
    console.error("❌ Get Product Media Error:", e);
    return res.status(500).json({ message: e.message });
  }
};


