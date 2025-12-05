import fs from "fs";
import path from "path";
import slugify from "slugify";

const norm = (s) => String(s || "").trim().replace(/\s+/g, " ");
const toSlug = (s) => slugify(norm(s), { lower: true, strict: true });

const num = (v, d = 0) => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : d;
};

const arr = (v) =>
  !v ? [] : Array.isArray(v) ? v : String(v).split(",").map((x) => x.trim()).filter(Boolean);

const tagsNorm = (v) => arr(v).map((t) => String(t || "").trim().toLowerCase()).filter(Boolean);

function pickCategoryFromList(catStrings, categoryMap) {
  // catStrings is like ["All Clothing", "T-Shirts", ...]
  // Strategy: first matching becomes category, second matching becomes subcategory (optional)
  const slugs = (catStrings || []).map(toSlug);
  const hits = slugs.filter((s) => categoryMap[s]);

  return {
    category: hits[0] ? categoryMap[hits[0]] : null,
    subcategory: hits[1] ? categoryMap[hits[1]] : null,
    categorySlug: hits[0] || null,
    subcategorySlug: hits[1] || null,
  };
}

function deriveProductPrice(variants) {
  const prices = variants.map((v) => num(v.price, 0)).filter((x) => x > 0);
  return prices.length ? Math.min(...prices) : 0;
}

function deriveCompareAt(variants) {
  const c = variants.map((v) => num(v.compareAtPrice, 0)).filter((x) => x > 0);
  return c.length ? Math.max(...c) : null;
}

function deriveStock(variants) {
  const total = variants.reduce((s, v) => s + num(v.stock, 0), 0);
  const any = variants.some((v) => num(v.stock, 0) > 0 && v.isInStock !== false);
  return { total, any };
}

function productLevelAttributesFromVariants(variants) {
  const bucket = new Map(); // key -> Set(values)
  for (const v of variants) {
    const attrs = Array.isArray(v?.attributes) ? v.attributes : [];
    for (const a of attrs) {
      const key = norm(a?.key);
      const value = norm(a?.value);
      if (!key || !value) continue;
      if (!bucket.has(key)) bucket.set(key, new Set());
      bucket.get(key).add(value);
    }
  }

  // attribute ObjectId is unknown yet => null
  // later we can map to Attribute IDs (Size/Color)
  return [...bucket.entries()].map(([key, set]) => ({
    attribute: null,
    key,
    values: [...set],
  }));
}

function variantAttributes(attrs) {
  return (attrs || [])
    .map((a) => {
      const key = norm(a?.key);
      const value = norm(a?.value);
      if (!key || !value) return null;
      return { attribute: null, key, value };
    })
    .filter(Boolean);
}

async function run() {
  const base = process.cwd();
  const input = path.resolve(base, "scripts", "wc_products_intermediate.json");
  const mapPath = path.resolve(base, "scripts", "categoryMap.json");
  const outPath = path.resolve(base, "scripts", "products_for_import.json");

  if (!fs.existsSync(input)) throw new Error(`Missing: ${input}`);
  if (!fs.existsSync(mapPath)) throw new Error(`Missing: ${mapPath}`);

  const raw = JSON.parse(fs.readFileSync(input, "utf-8"));
  const categoryMap = JSON.parse(fs.readFileSync(mapPath, "utf-8"));

  const list = Array.isArray(raw?.products) ? raw.products : [];
  const products = [];

  let missingCategory = 0;

  for (const p of list) {
    const title = norm(p?.title);
    if (!title) continue;

    // slug: use WP slug if present; else derive; ensure uniqueness by appending wordpressId
    const wpId = p?.wordpressId ?? null;
    const baseSlug = norm(p?.slug) ? toSlug(p.slug) : toSlug(title);
    const slug = wpId ? `${baseSlug}-${wpId}` : baseSlug;

    const images = Array.isArray(p?.images) ? p.images.filter(Boolean) : [];
    const thumbnail = images[0] || "";

    const variantsIn = Array.isArray(p?.variants) ? p.variants : [];

    const variants = variantsIn.map((v) => ({
      attributes: variantAttributes(v?.attributes),
      sku: norm(v?.sku), // can be empty; your model can generate IF you save via create (not insertMany)
      barcode: norm(v?.barcode),
      price: num(v?.price, 0),
      compareAtPrice: v?.compareAtPrice != null ? num(v?.compareAtPrice, 0) : null,
      stock: num(v?.stock, 0),
      isInStock: v?.isInStock === true || num(v?.stock, 0) > 0,
      image: norm(v?.image),
      weight: num(v?.weightKg, 0),
    }));

    const { category, subcategory } = pickCategoryFromList(p?.categories, categoryMap);
    if (!category) missingCategory++;

    const price = deriveProductPrice(variants);
    const compareAtPrice = deriveCompareAt(variants);
    const { total, any } = deriveStock(variants);

    const prodDoc = {
      title,
      slug,

      description: p?.description || "",
      shortDescription: p?.shortDescription || "",
      highlights: [],

      category: category || null,      // REQUIRED by schema => we’ll handle missing below
      subcategory: subcategory || null,
      collections: [],

      tags: tagsNorm(p?.tags),

      price: price || 0,
      compareAtPrice,
      currency: "INR",
      taxClass: norm(p?.taxClass) || "standard",

      // For variable products keep sku empty; variants will have sku or will be generated later
      sku: undefined,
      stock: total,
      isInStock: any,

      attributes: productLevelAttributesFromVariants(variantsIn),

      variants,

      images,
      thumbnail,
      video: "",

      weight: num(p?.weightKg, 0),
      dimensions: {
        length: num(p?.dimensionsCm?.length, 0),
        width: num(p?.dimensionsCm?.width, 0),
        height: num(p?.dimensionsCm?.height, 0),
        unit: "cm",
      },

      averageRating: 0,
      totalReviews: 0,
      reviews: [],

      offer: null,
      couponsApplicable: [],

      analytics: {
        views: 0,
        purchases: 0,
        wishlistCount: 0,
        cartAdds: 0,
        searchAppearances: 0,
      },

      productType: variants.length ? "variable" : "simple",
      externalURL: "",

      metaTitle: "",
      metaDescription: "",
      keywords: [],

      isActive: String(p?.published || "").toLowerCase() === "true" || String(p?.published || "") === "1",
      isFeatured: String(p?.isFeatured || "").toLowerCase() === "true" || String(p?.isFeatured || "") === "1",
      isDraft: false,
      publishAt: new Date().toISOString(),

      wordpressId: wpId,
    };

    products.push(prodDoc);
  }

  // If any products have no category, set them to "uncategorized" if it exists
  const uncId = categoryMap["uncategorized"] || null;
  if (uncId) {
    for (const p of products) if (!p.category) p.category = uncId;
    missingCategory = products.filter((p) => !p.category).length;
  }

  fs.writeFileSync(outPath, JSON.stringify({ products }, null, 2));
  console.log(`✅ products_for_import.json written: ${outPath}`);
  console.log(`✅ products: ${products.length}`);
  console.log(`⚠️ missing category after fallback: ${missingCategory}`);
  console.log(`ℹ️ NOTE: attributes.attribute and variants.attributes.attribute are null for now (we’ll map after Attribute seeding).`);
}

run().catch((e) => {
  console.error("❌ wooJsonToProductImport failed:", e.message || e);
  process.exit(1);
});
