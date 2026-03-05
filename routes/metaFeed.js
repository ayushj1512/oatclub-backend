// routes/metaFeed.js
import express from "express";
import Product from "../Products/Products.js";

const router = express.Router();

const SITE_BASE = "https://www.mirayfashions.com";
const BRAND = "Miray Fashions";
const CURRENCY = "INR";

// ✅ FORCE ALL PRODUCTS AS IN STOCK (unlimited)
const ALWAYS_IN_STOCK = true;

const CACHE_TTL_MS = 55 * 60 * 1000;

// ✅ Inventory: "infinite" quantity to satisfy Meta Commerce surfaces
const INVENTORY_INFINITE = 999999;

let cache = {
  xml: "",
  etag: "",
  expiresAt: 0,
  meta: { count: 0, builtAt: null },
};

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const clamp = (s, n) => {
  const t = String(s ?? "").trim();
  return t.length > n ? t.slice(0, n).trim() : t;
};

const slugify = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "products";

const safeArr = (v) => (Array.isArray(v) ? v : []);

const pickImages = (p) => {
  const out = [];
  const thumb = String(p?.thumbnail || "").trim();
  if (thumb) out.push(thumb);

  for (const u of safeArr(p?.images)) {
    const s = String(u || "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
};

const buildLink = (p) => {
  const cat = slugify(p?.categories?.[0]);
  const slug = String(p?.slug ?? "").trim();
  const id = String(p?._id ?? "").trim();
  return `${SITE_BASE}/category/${encodeURIComponent(cat)}/${encodeURIComponent(
    slug
  )}/${encodeURIComponent(id)}`;
};

const fmtMoney = (n) =>
  `${(Number.isFinite(Number(n)) ? Number(n) : 0).toFixed(2)} ${CURRENCY}`;

const looksLikeGTIN = (s) => {
  const t = String(s || "").trim();
  if (!/^\d+$/.test(t)) return false;
  return [8, 12, 13, 14].includes(t.length);
};

const getAttr = (attrs, key) => {
  const k = String(key || "").trim().toLowerCase();
  const a = safeArr(attrs).find(
    (x) => String(x?.key || "").trim().toLowerCase() === k
  );
  return String(a?.value || "").trim();
};

/**
 * ✅ Google product category mapping (simple starter)
 */
const getGoogleProductCategory = (categories = []) => {
  const c0 = String(categories?.[0] || "").trim().toLowerCase();

  if (/(top|tshirt|tee|shirt|blouse|crop|corset|tank)/.test(c0))
    return "Apparel & Accessories > Clothing > Shirts & Tops";
  if (/(dress|gown)/.test(c0))
    return "Apparel & Accessories > Clothing > Dresses";
  if (/(trouser|pant|jeans|bottom)/.test(c0))
    return "Apparel & Accessories > Clothing > Pants";
  if (/(skirt)/.test(c0))
    return "Apparel & Accessories > Clothing > Skirts";
  if (/(jacket|coat|blazer|hoodie|sweatshirt)/.test(c0))
    return "Apparel & Accessories > Clothing > Outerwear";
  if (/(footwear|shoe|heels|sneaker|boot|sandal)/.test(c0))
    return "Apparel & Accessories > Shoes";
  if (/(bag|handbag|purse)/.test(c0))
    return "Apparel & Accessories > Handbags, Wallets & Cases > Handbags";
  if (/(accessor|belt|cap|hat|sunglass|scarf)/.test(c0))
    return "Apparel & Accessories > Clothing Accessories";

  return "Apparel & Accessories";
};

const buildItemXml = ({
  id,
  itemGroupId,
  title,
  desc,
  link,
  images,
  price,
  compareAtPrice,
  availability,
  inventory,
  color,
  size,
  gtin,
  mpn,
  productTypePath,
  googleProductCategory,
  customLabel0,
}) => {
  const hasSale =
    Number.isFinite(Number(compareAtPrice)) &&
    Number(compareAtPrice) > Number(price);

  const mainImage = images?.[0] || "";
  const extraImages = safeArr(images).slice(1, 11);

  const invNum = Number.isFinite(Number(inventory)) ? Number(inventory) : 0;

  return `<item>
<g:id>${esc(id)}</g:id>
${itemGroupId ? `<g:item_group_id>${esc(itemGroupId)}</g:item_group_id>` : ""}
<g:title>${esc(clamp(title, 150))}</g:title>
<g:description>${esc(clamp(desc, 5000))}</g:description>
<g:link>${esc(link)}</g:link>

${mainImage ? `<g:image_link>${esc(mainImage)}</g:image_link>` : ""}
${extraImages
  .map((u) => `<g:additional_image_link>${esc(u)}</g:additional_image_link>`)
  .join("\n")}

<g:availability>${esc(availability)}</g:availability>
<g:condition>new</g:condition>
<g:brand>${esc(BRAND)}</g:brand>

${googleProductCategory ? `<g:google_product_category>${esc(googleProductCategory)}</g:google_product_category>` : ""}
${productTypePath ? `<g:product_type>${esc(productTypePath)}</g:product_type>` : ""}
${customLabel0 ? `<g:custom_label_0>${esc(customLabel0)}</g:custom_label_0>` : ""}

${color ? `<g:color>${esc(color)}</g:color>` : ""}
${size ? `<g:size>${esc(size)}</g:size>` : ""}

${
  hasSale
    ? `<g:price>${esc(fmtMoney(compareAtPrice))}</g:price>
<g:sale_price>${esc(fmtMoney(price))}</g:sale_price>`
    : `<g:price>${esc(fmtMoney(price))}</g:price>`
}

${gtin ? `<g:gtin>${esc(gtin)}</g:gtin>` : ""}
${mpn ? `<g:mpn>${esc(mpn)}</g:mpn>` : ""}

<g:inventory>${esc(invNum)}</g:inventory>

</item>`;
};

const buildXml = (itemsXml) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${esc("Miray Fashions Product Feed")}</title>
<link>${esc(SITE_BASE)}</link>
<description>${esc("Latest catalog feed for Meta/Google Commerce.")}</description>
${itemsXml}
</channel>
</rss>`;

async function rebuildFeed() {
  // ✅ Only "published" products:
  // - isActive true
  // - isDraft false
  // - publishAt <= now
  const now = new Date();

  const products = await Product.find({
    isActive: true,
    isDraft: false,
    publishAt: { $lte: now },
  })
    .select(
      [
        "title",
        "slug",
        "shortDescription",
        "howToStyle",
        "fabricDetails",
        "keyFeatures",
        "categories",
        "thumbnail",
        "images",
        "price",
        "compareAtPrice",
        "productType",
        "variants.sku",
        "variants.barcode",
        "variants.attributes",
        "updatedAt",
      ].join(" ")
    )
    .sort({ updatedAt: -1 })
    .lean();

  const items = [];

  for (const p of products) {
    const productId = String(p?._id || "").trim();
    const title = String(p?.title || "").trim();
    const link = buildLink(p);
    const images = pickImages(p);

    const desc =
      String(p?.shortDescription || "").trim() ||
      String(p?.howToStyle || "").trim() ||
      "";

    const cats = safeArr(p?.categories)
      .map((c) => String(c || "").trim())
      .filter(Boolean);

    const productTypePath = cats.join(" > ");
    const googleProductCategory = getGoogleProductCategory(cats);
    const customLabel0 = cats[0] || "";

    const isVariable =
      p?.productType === "variable" || safeArr(p?.variants).length > 0;

    // ✅ Forced availability + inventory for EVERY item
    const availability = ALWAYS_IN_STOCK ? "in stock" : "out of stock";
    const inventory = ALWAYS_IN_STOCK ? INVENTORY_INFINITE : 0;

    if (isVariable && safeArr(p?.variants).length) {
      for (const v of p.variants) {
        const sku = String(v?.sku || "").trim();
        const variantId = String(v?._id || "").trim();
        const id = sku || `${productId}-${variantId}`;

        const color = getAttr(v?.attributes, "color");
        const size = getAttr(v?.attributes, "size");

        const rawGtin = String(v?.barcode || "").trim();
        const gtin = looksLikeGTIN(rawGtin) ? rawGtin : "";

        items.push(
          buildItemXml({
            id,
            itemGroupId: productId,
            title,
            desc,
            link,
            images,
            price: p?.price,
            compareAtPrice: p?.compareAtPrice,
            availability,
            inventory,
            color,
            size,
            gtin,
            mpn: sku || "",
            productTypePath,
            googleProductCategory,
            customLabel0,
          })
        );
      }
    } else {
      items.push(
        buildItemXml({
          id: productId,
          itemGroupId: "",
          title,
          desc,
          link,
          images,
          price: p?.price,
          compareAtPrice: p?.compareAtPrice,
          availability,
          inventory,
          color: "",
          size: "",
          gtin: "",
          mpn: "",
          productTypePath,
          googleProductCategory,
          customLabel0,
        })
      );
    }
  }

  const xml = buildXml(items.join("\n"));
  const t = Date.now();

  cache = {
    xml,
    etag: `W/"${xml.length}-${t}"`,
    expiresAt: t + CACHE_TTL_MS,
    meta: { count: items.length, builtAt: new Date(t).toISOString() },
  };

  return cache;
}

async function getFeed(force = false) {
  const t = Date.now();
  if (!force && cache.xml && cache.expiresAt > t) return cache;
  return rebuildFeed();
}

/* quick test */
router.get("/test", (req, res) => res.send("meta feed router OK"));

/* public xml */
router.get("/xml", async (req, res) => {
  try {
    const feed = await getFeed(false);

    if (req.headers["if-none-match"] === feed.etag) return res.status(304).end();

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=1800");
    res.setHeader("ETag", feed.etag);

    return res.status(200).send(feed.xml);
  } catch (e) {
    console.error("❌ Meta XML feed failed:", e?.message || e);
    return res.status(500).send("Feed generation failed");
  }
});

/* manual refresh (for admin button) */
router.post("/meta-feed/refresh", async (req, res) => {
  try {
    const feed = await getFeed(true);
    return res.json({
      ok: true,
      count: feed.meta.count,
      builtAt: feed.meta.builtAt,
    });
  } catch (e) {
    console.error("❌ Meta feed refresh failed:", e?.message || e);
    return res
      .status(500)
      .json({ ok: false, message: e?.message || "Refresh failed" });
  }
});

/* status (for admin page) */
router.get("/meta-feed/status", (req, res) => {
  return res.json({
    ok: true,
    count: cache.meta.count,
    builtAt: cache.meta.builtAt,
    cached: !!cache.xml,
    expiresAt: cache.expiresAt,
  });
});

export default router;

/*
Mount:
app.use("/", metaFeedRouter);

URLs:
GET  /xml
GET  /test
POST /meta-feed/refresh
GET  /meta-feed/status
*/