import csv from "csvtojson";
import slugify from "slugify";
import Product from "./Products.js";

/* ============================================================
   HELPERS
============================================================ */

// ✅ parse images string or array
const parseImages = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);

  return String(val)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
};

// ✅ normalize tags
const tagsNorm = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val.map((t) => String(t).trim().toLowerCase());

  return String(val)
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
};

// ✅ parse attributes: size:S,M,L|color:Black,White
const parseAttributes = (attrStr) => {
  if (!attrStr) return [];
  if (Array.isArray(attrStr)) return attrStr;

  return String(attrStr)
    .split("|")
    .map((group) => {
      const [key, values] = group.split(":");
      return {
        key: key?.trim(),
        values: values
          ? values.split(",").map((v) => v.trim()).filter(Boolean)
          : [],
      };
    })
    .filter((a) => a.key);
};

// ✅ parse variants: size:S;color:Black;price:999;stock:10|size:M;color:White;price:999;stock:2
const parseVariants = (variantStr) => {
  if (!variantStr) return [];
  if (Array.isArray(variantStr)) return variantStr;

  return String(variantStr)
    .split("|")
    .map((v) => {
      const parts = v.split(";");
      const attributes = [];
      let price = null;
      let stock = 0;
      let sku = null;

      for (const p of parts) {
        const [k, val] = p.split(":");
        if (!k || !val) continue;

        const key = k.trim();
        const value = val.trim();

        if (key === "price") price = Number(value);
        else if (key === "stock") stock = Number(value);
        else if (key === "sku") sku = value;
        else attributes.push({ key, value });
      }

      return {
        attributes,
        price: Number.isFinite(price) ? price : 0,
        stock: Number(stock || 0),
        isInStock: Number(stock || 0) > 0,
        sku,
      };
    })
    .filter((v) => v.attributes?.length);
};

// ✅ Generate combinations when variants missing
const generateVariantCombos = (attributes, basePrice = 0, stock = 0) => {
  if (!Array.isArray(attributes) || !attributes.length) return [];

  const keys = attributes.map((a) => a.key);
  const valuesList = attributes.map((a) => (Array.isArray(a.values) ? a.values : []));

  // if any attribute has no values → cannot generate variants
  if (valuesList.some((vals) => !vals.length)) return [];

  const combos = valuesList.reduce((acc, curr) => {
    const res = [];
    acc.forEach((a) => curr.forEach((b) => res.push([...a, b])));
    return res;
  }, [[]]);

  return combos.map((combo) => ({
    attributes: combo.map((val, i) => ({
      key: keys[i],
      value: val,
    })),
    price: basePrice,
    stock,
    isInStock: stock > 0,
  }));
};

/* ============================================================
   PREVIEW PRODUCTS FROM CSV
============================================================ */

export const bulkPreviewProducts = async (req, res) => {
  try {
    if (!req.file?.path) {
      return res.status(400).json({ message: "CSV file missing" });
    }

    const rows = await csv().fromFile(req.file.path);
    const preview = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      const title = String(r.title || "").trim();
      const price = Number(r.price);
      const category = String(r.category || "").trim();

      const errors = [];
      if (!title) errors.push("Missing title");
      if (!Number.isFinite(price)) errors.push("Invalid price");
      if (!category) errors.push("Missing category");

      const images = parseImages(r.images);
      const thumbnail = r.thumbnail || images[0] || "";

      const attributes = parseAttributes(r.attributes);
      let variants = parseVariants(r.variants);

      // ✅ auto generate variants if needed
      if (!variants.length && attributes.length) {
        variants = generateVariantCombos(attributes, price, Number(r.stock || 0));
      }

      preview.push({
        row: i + 1,
        title,
        price,
        compareAtPrice: r.compareAtPrice ? Number(r.compareAtPrice) : null,

        categories: category ? [category] : [],
        tags: tagsNorm(r.tags),

        shortDescription: r.shortDescription || "",
        description: r.description || "",

        images,
        thumbnail,
        attributes,
        variants,

        stock: Number(r.stock || 0),
        isValid: errors.length === 0,
        errors,
      });
    }

    res.json({ preview });
  } catch (e) {
    console.error("❌ Preview Error:", e);
    res.status(400).json({ message: e.message });
  }
};

/* ============================================================
   CREATE DRAFT PRODUCTS (FROM PREVIEW ROWS)
============================================================ */

export const bulkCreateDraftProducts = async (req, res) => {
  try {
    const { rows } = req.body;

    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ message: "No rows provided" });
    }

    const docs = [];

    for (const r of rows) {
      const images = parseImages(r.images);
      const thumbnail = r.thumbnail || images[0] || "";

      const attributes = parseAttributes(r.attributes);
      let variants = parseVariants(r.variants);

      if (!variants.length && attributes.length) {
        variants = generateVariantCombos(
          attributes,
          Number(r.price),
          Number(r.stock || 0)
        );
      }

      const data = {
        title: r.title,
        slug: slugify(r.title, { lower: true, strict: true }),

        price: Number(r.price),
        compareAtPrice: r.compareAtPrice ?? null,
        categories: Array.isArray(r.categories) ? r.categories : [],

        tags: tagsNorm(r.tags),
        shortDescription: r.shortDescription || "",
        description: r.description || "",

        images,
        thumbnail,
        attributes,
        variants,

        // ✅ if variants exist, productType becomes variable
        productType: variants?.length ? "variable" : "simple",

        stock: Number(r.stock || 0),
        sku: r.sku || undefined,

        isDraft: true,
        isActive: false,
        importSource: "bulk",
      };

      docs.push(data);
    }

    // ✅ Insert
    const created = await Product.insertMany(docs, { ordered: false });

    res.json({
      message: "Bulk draft products created successfully",
      createdCount: created.length,
    });
  } catch (e) {
    console.error("❌ Bulk Draft Create Error:", e);

    // ✅ If partial failures happen (duplicate SKU/slug)
    if (e?.writeErrors) {
      return res.status(400).json({
        message: "Some products failed to import",
        failedCount: e.writeErrors.length,
        errors: e.writeErrors.map((x) => ({
          index: x.index,
          message: x.errmsg,
        })),
      });
    }

    res.status(500).json({ message: e.message });
  }
};
