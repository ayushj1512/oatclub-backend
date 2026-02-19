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
        const key = s(k), value = s(val);
        if (key) out.push({ key, value });
      };

      if (typeof v === "string") {
        const t = v.trim();
        if (!t) return [];
        try { v = JSON.parse(t); }
        catch {
          (t.includes("|") ? t.split("|") : t.split(",")).forEach((p) => {
            const x = s(p); if (!x) return;
            const sep = x.includes(":") ? ":" : x.includes("=") ? "=" : null;
            if (!sep) return;
            const [k, ...rest] = x.split(sep);
            push(k, rest.join(sep));
          });
          return out;
        }
      }

      if (Array.isArray(v)) { v.forEach((r) => r && push(r.key, r.value)); return out; }
      if (v && typeof v === "object") { Object.entries(v).forEach(([k, val]) => push(k, val)); return out; }
      return [];
    };

    const normFabrics = (v) => {
      const ROLES = new Set(["main", "lining", "contrast", "padding", "other"]);
      const out = [];
      const push = (row) => {
        if (!row) return;

        if (typeof row === "string") {
          const name = s(row);
          if (name) out.push({ fabricName: name, fabricCode: "", fabricColor: "", role: "main" });
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

        const finalName = fabricName || fabricCode; // backward compat
        if (!finalName) throw new Error("Fabric name is required in fabrics[]");

        out.push({ fabricName: finalName, fabricCode: fabricCode || "", fabricColor: fabricColor || "", role });
      };

      if (typeof v === "string") {
        const t = v.trim();
        if (!t) return [];
        try { v = JSON.parse(t); }
        catch {
          (t.includes("|") ? t.split("|") : t.split(",")).forEach((p) => push(String(p || "")));
          return out;
        }
      }

      if (Array.isArray(v)) { v.forEach(push); return out; }
      if (v && typeof v === "object") {
        const looksSingle = ("fabricName" in v) || ("fabricCode" in v) || ("fabricColor" in v) || ("role" in v);
        if (looksSingle) { push(v); return out; }
        Object.entries(v).forEach(([role, name]) => push({ role, fabricName: name }));
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

    // ✅ fabrics (optional)
    try {
      if (data.fabrics !== undefined) data.fabrics = normFabrics(data.fabrics);
      else data.fabrics = [];
    } catch (err) {
      return res.status(400).json({ message: err.message || "Invalid fabrics" });
    }

    data.avgFabricConsumption = json(data.avgFabricConsumption, data.avgFabricConsumption);

    if (data.colors !== undefined) {
      data.colors = Array.from(
        new Set(arr(data.colors).map((c) => s(c).toLowerCase()).filter(Boolean))
      );
    }

    if (data.hsnCode !== undefined) {
      const hsn = s(data.hsnCode);
      if (hsn && !/^\d+$/.test(hsn)) {
        return res.status(400).json({ message: "HSN code must contain digits only" });
      }
      data.hsnCode = hsn;
    }

    data.isBestSeller = data.isBestSeller !== undefined ? toBool(data.isBestSeller) : false;

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

    const hadNewArrivals = data.categories.some((c) => String(c).toLowerCase() === "new-arrivals");
    data.categories = data.categories.filter((c) => !SYSTEM_CATEGORIES.has(String(c).toLowerCase()));

    if (hadNewArrivals) data.tags = Array.from(new Set([...(data.tags || []), "new-arrival"]));

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
      data.specifications = Array.isArray(data.specifications) ? data.specifications : [];
    } else {
      await validateAttributes(data.attributes);

      if (Array.isArray(data.variants)) data.variants = data.variants.map(({ image, ...v }) => v);

      data.variants = keepOnlySizeVariants(
        generateVariants({
          productAttributes: data.attributes,
          existingVariants: [],
          variantKeys: VARIANT_KEYS,
        })
      );

      data.productType = data.variants.length ? "variable" : "simple";
      data.variants = (data.variants || []).map((v) => ({ ...v, patternNumber: s(v?.patternNumber) }));

      if (!Array.isArray(data.colors)) data.colors = [];
      if (!Array.isArray(data.specifications)) data.specifications = [];
    }

    /* ---------------- cross-sell ---------------- */
    data.crossSellProducts = (Array.isArray(data.crossSellProducts)
      ? data.crossSellProducts
      : typeof data.crossSellProducts === "string"
        ? data.crossSellProducts.split(",").map((id) => s(id))
        : []).filter(isValidObjectId);

    /* ---------------- uploads ---------------- */
    const { images, thumbnail } = await mergeUploads(req, {
      images: data.images,
      thumbnail: data.thumbnail,
    });

    data.images = images;
    data.thumbnail = thumbnail;

    if (!isBulk && (!data.images || !data.images.length)) {
      return res.status(400).json({ message: "At least one product image is required" });
    }

    if (isBulk) {
      data.images = [];
      data.thumbnail = "";
      data.isDraft = true;
      data.isActive = false;
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
    });

    if (Array.isArray(skuPayload.variants)) created.markModified("variants");
    ["colors", "keyFeatures", "shortDescription", "howToStyle", "fabricDetails", "specifications", "isBestSeller"].forEach((k) =>
      created.markModified(k)
    );

    await created.save({ validateBeforeSave: true });

    await Product.updateOne({ _id: created._id }, { $pull: { crossSellProducts: created._id } });

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
      category,
      collection,
      tags,
      minPrice,
      maxPrice,
      isActive,
      search,
      sort,
      sku,

      // ✅ optional aliases
      q,
      title,
      productCode,
      code,
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

      if (cats.length) filters.categories = { $in: cats };
    }

    /* ---------------- collections ---------------- */
    if (collection) filters.collections = collection;

    /* ---------------- tags ---------------- */
    const t = tagsNorm(tags);
    if (t.length) filters.tags = { $in: t };

    /* ---------------- active ---------------- */
    if (isActive !== undefined) filters.isActive = isActive === "true";

    /* ---------------- SKU exact ---------------- */
    if (sku) {
      filters.$or = [{ sku: String(sku) }, { "variants.sku": String(sku) }];
    }

    /* ---------------- ✅ productCode search (supports search/q/title too) ---------------- */
    applyProductCodeFilter(filters, { q, title, productCode, code, search });

    /* ---------------- price ---------------- */
    if (minPrice || maxPrice) {
      filters.price = {};
      if (minPrice) filters.price.$gte = Number(minPrice);
      if (maxPrice) filters.price.$lte = Number(maxPrice);
    }

    /* ---------------- ✅ $text search (ONLY when query is NOT numeric) ---------------- */
    const qStr = String(q ?? "").trim();
    const titleStr = String(title ?? "").trim();
    const searchStr = String(search ?? "").trim();
    const pcStr = String(productCode ?? "").trim();
    const codeStr = String(code ?? "").trim();

    // if any param is numeric => it's a code-search, skip $text
    const isCodeQuery =
      isDigitsOnly(qStr) ||
      isDigitsOnly(titleStr) ||
      isDigitsOnly(searchStr) ||
      isDigitsOnly(pcStr) ||
      isDigitsOnly(codeStr);

    let searchText = "";
    if (!isCodeQuery) {
      // prefer explicit "search", else fallback to q/title
      searchText = searchStr || qStr || titleStr;
    }

    if (searchText) filters.$text = { $search: searchText };

    /* ---------------- sorting ---------------- */
    const sortMap = {
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      newest: { createdAt: -1 },
      rating: { averageRating: -1 },
      popularity: { "analytics.views": -1 },
    };

    const safeLimit = Math.min(200, Math.max(1, Number(limit)));
    const safePage = Math.max(1, Number(page));
    const skip = (safePage - 1) * safeLimit;
    const sortObj = sortMap[sort] || { createdAt: -1 };

    const docs = await pop(Product.find(filters))
      .sort(sortObj)
      .skip(skip)
      .limit(safeLimit);

    const total = await Product.countDocuments(filters);

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
        const key = s(k), value = s(val);
        if (key) out.push({ key, value });
      };

      if (typeof v === "string") {
        const t = v.trim();
        if (!t) return [];
        try { v = JSON.parse(t); }
        catch {
          (t.includes("|") ? t.split("|") : t.split(",")).forEach((p) => {
            const x = s(p); if (!x) return;
            const sep = x.includes(":") ? ":" : x.includes("=") ? "=" : null;
            if (!sep) return;
            const [k, ...rest] = x.split(sep);
            push(k, rest.join(sep));
          });
          return out;
        }
      }

      if (Array.isArray(v)) { v.forEach((r) => r && push(r.key, r.value)); return out; }
      if (v && typeof v === "object") { Object.entries(v).forEach(([k, val]) => push(k, val)); return out; }
      return [];
    };

    const normFabrics = (v) => {
      const ROLES = new Set(["main", "lining", "contrast", "padding", "other"]);
      const out = [];

      const push = (row) => {
        if (!row) return;

        if (typeof row === "string") {
          const name = s(row);
          if (name) out.push({ fabricName: name, fabricCode: "", fabricColor: "", role: "main" });
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

        const finalName = fabricName || fabricCode; // backward compat
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
        try { v = JSON.parse(t); }
        catch {
          (t.includes("|") ? t.split("|") : t.split(",")).forEach((p) => push(String(p || "")));
          return out;
        }
      }

      if (Array.isArray(v)) { v.forEach(push); return out; }
      if (v && typeof v === "object") {
        const looksSingle =
          ("fabricName" in v) || ("fabricCode" in v) || ("fabricColor" in v) || ("role" in v);
        if (looksSingle) { push(v); return out; }
        Object.entries(v).forEach(([role, name]) => push({ role, fabricName: name }));
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
      try { data.fabrics = normFabrics(json(data.fabrics, data.fabrics)); }
      catch (err) { return res.status(400).json({ message: err.message || "Invalid fabrics" }); }
    }

    if (data.avgFabricConsumption !== undefined) {
      data.avgFabricConsumption = json(data.avgFabricConsumption, data.avgFabricConsumption);
    }

    if (data.isSamplingDone !== undefined) data.isSamplingDone = toBool(data.isSamplingDone);
    if (data.isBestSeller !== undefined) data.isBestSeller = toBool(data.isBestSeller);
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

      // ✅ NEW (optional)
      q,
      title,
      productCode,
      code,
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
        $or: [{ slug: String(categoryParam).toLowerCase() }, { name: categoryParam }],
      });
    }

    /* ---------------------------------------------------------
       ✅ If category exists → match both slug + name
       ✅ else fallback → match raw param as string in Product.categories
    --------------------------------------------------------- */
    const categoryMatch = catDoc ? [catDoc.slug, catDoc.name] : [categoryParam];

    const filters = {
      categories: { $in: categoryMatch },
    };

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
       Works with: ?productCode=00336  OR ?q=336  OR ?code=00336
       Matches:
       - productCode exact
       - sku / variants.sku contains code (CAT-00336-XS)
    --------------------------------------------------------------- */
    // If your helper merges $or internally, this is enough:
    applyProductCodeFilter(filters, { q, title, productCode, code });

    // ⚠️ If your helper DOES NOT merge $or (it overwrites),
    // then replace the line above with a "safe merge" approach inside helper.

    /* ---------------- price ---------------- */
    if (minPrice || maxPrice) {
      filters.price = {};
      if (minPrice) filters.price.$gte = Number(minPrice);
      if (maxPrice) filters.price.$lte = Number(maxPrice);
    }

    /* ---------------- search ($text) ---------------- */
    // keep explicit search
    // + allow fallback search from q/title when they are NOT numeric
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

    /* ---------------- optional filters ---------------- */
    const filters = {};

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
    const safePage = Math.max(1, Number(page));
    const skip = (safePage - 1) * safeLimit;

    // ✅ treat empty string / missing sort as "default"
    const sortKey = String(sort ?? "").trim();
    const hasExplicitSort = Boolean(sortKey) && Boolean(sortMap[sortKey]);

    /* ---------------------------------------------------------
       ✅ Manual order (DEFAULT): use collectionDoc.products order
       - Works with pagination
       - Still applies filters
    --------------------------------------------------------- */
    const extractIdsFromCollection = (col) => {
      const arr = Array.isArray(col?.products) ? col.products : [];
      const ids = arr
        .map((it) => {
          if (!it) return null;
          if (typeof it === "string") return it;
          if (typeof it === "object") {
            const pr = it.product ?? it._id ?? it.id;
            if (!pr) return null;
            return typeof pr === "object" ? (pr._id ?? pr.id) : pr;
          }
          return null;
        })
        .filter(Boolean)
        .map(String);

      // uniq while preserving order
      const seen = new Set();
      const out = [];
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
      return out;
    };

    const orderedIdStrings = extractIdsFromCollection(collectionDoc);
    const orderedIds = orderedIdStrings
      .filter((x) => mongoose.Types.ObjectId.isValid(x))
      .map((x) => new mongoose.Types.ObjectId(x));

    // fallback: if collection has no ordered ids, use old behavior via collections field
    const shouldUseManualOrder = !hasExplicitSort && orderedIds.length > 0;

    let docs = [];
    let total = 0;

    if (shouldUseManualOrder) {
      // Manual order pipeline:
      // match: _id in orderedIds + filters
      // addFields: _sortIndex = indexOfArray(orderedIds, _id)
      // sort by _sortIndex asc
      // paginate with skip/limit
      const matchStage = { _id: { $in: orderedIds }, ...filters };

      const pipeline = [
        { $match: matchStage },
        {
          $addFields: {
            _sortIndex: { $indexOfArray: [orderedIds, "$_id"] },
          },
        },
        { $sort: { _sortIndex: 1 } },
        { $skip: skip },
        { $limit: safeLimit },
      ];

      // If you have a "pop" helper for populate, aggregation can't use it.
      // So we fetch ids first then do a populated find in the same order.

      const pageRows = await Product.aggregate(pipeline);
      const pageIds = pageRows.map((r) => r._id);

      // total count (filtered, within this collection order list)
      total = await Product.countDocuments(matchStage);

      // fetch populated docs
      let found = await pop(Product.find({ _id: { $in: pageIds } }));
      // re-order exactly by pageIds
      const m = new Map(found.map((p) => [String(p._id), p]));
      docs = pageIds.map((id) => m.get(String(id))).filter(Boolean);
    } else {
      // Old behavior (explicit sort OR no manual list)
      // Ensure membership by collections field
      const findFilters = { ...filters, collections: collectionDoc._id };

      const sortObj = sortMap[sortKey] || { createdAt: -1 };

      docs = await pop(Product.find(findFilters))
        .sort(sortObj)
        .skip(skip)
        .limit(safeLimit);

      total = await Product.countDocuments(findFilters);
    }

    return res.json({
      collection: {
        _id: collectionDoc._id,
        name: collectionDoc.name,
        slug: collectionDoc.slug,
        // ✅ send ordered ids too (helps frontend)
        products: orderedIdStrings,
      },
      total,
      page: safePage,
      pages: Math.ceil(total / safeLimit),
      products: (docs || []).map(applyStockFromVariants),
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


