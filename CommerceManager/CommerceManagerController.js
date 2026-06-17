import CommerceManager from "./CommerceManager.js";
import Product from "../Products/Products.js";

const SITE_BASE = "https://www.oatclub.in";
const BRAND = "Oatclub";
const CURRENCY = "INR";
const CACHE_TTL_MS = 55 * 60 * 1000;
const META_GENDER = "female";
const META_AGE_GROUP = "adult";
const META_INVENTORY = 999999;

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

const normalizeCodes = (codes) =>
  Array.isArray(codes)
    ? [...new Set(codes.map(normalizeCode).filter(Boolean))]
    : [];

const safeArr = (v) => (Array.isArray(v) ? v : []);

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

const fmtMoney = (n) =>
  `${(Number.isFinite(Number(n)) ? Number(n) : 0).toFixed(2)} ${CURRENCY}`;

const looksLikeGTIN = (s) => {
  const t = String(s || "").trim();
  return /^\d+$/.test(t) && [8, 12, 13, 14].includes(t.length);
};

const getAttr = (attrs, key) => {
  const wanted = String(key || "").trim().toLowerCase();
  const match = safeArr(attrs).find(
    (x) => String(x?.key || "").trim().toLowerCase() === wanted
  );
  return String(match?.value || "").trim();
};

const firstNonEmpty = (...values) => {
  for (const value of values) {
    const v = String(value ?? "").trim();
    if (v) return v;
  }
  return "";
};

const pickImages = (product) => {
  const out = [];
  const thumb = String(product?.thumbnail || "").trim();
  if (thumb) out.push(thumb);

  for (const img of safeArr(product?.images)) {
    const url = String(img || "").trim();
    if (url && !out.includes(url)) out.push(url);
  }

  return out;
};

const buildLink = (product) => {
  const cat = slugify(product?.categories?.[0]);
  const slug = String(product?.slug || "").trim();
  const id = String(product?._id || "").trim();

  return `${SITE_BASE}/category/${encodeURIComponent(cat)}/${encodeURIComponent(
    slug
  )}/${encodeURIComponent(id)}`;
};

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

const getProductColor = (product, variant = null) => {
  const variantColor = getAttr(variant?.attributes, "color");

  const productColor =
    safeArr(product?.colors)
      .map((c) => String(c || "").trim())
      .find(Boolean) || "";

  const specColor =
    safeArr(product?.specifications).find(
      (row) => String(row?.key || "").trim().toLowerCase() === "color"
    )?.value || "";

  return firstNonEmpty(variantColor, productColor, specColor, "NA");
};

const getPossibleCodes = (product) => {
  const codes = new Set();

  const pushCode = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return;

    codes.add(normalizeCode(raw));

    const num = Number(raw);
    if (!Number.isNaN(num)) codes.add(String(num));

    const parts = raw.match(/\d+/g) || [];
    for (const part of parts) {
      codes.add(normalizeCode(part));
      const partNum = Number(part);
      if (!Number.isNaN(partNum)) codes.add(String(partNum));
    }
  };

  pushCode(product?.productCode);
  pushCode(product?.code);
  pushCode(product?.sku);
  pushCode(product?.productDetails?.productCode);
  pushCode(product?.productDetails?.code);

  for (const variant of safeArr(product?.variants)) {
    pushCode(variant?.sku);
    pushCode(variant?.code);
  }

  return [...codes];
};

const toSafeResponse = (doc) => ({
  _id: doc?._id,
  name: doc?.name,
  selectedProductCodes: doc?.selectedProductCodes || [],
  selectedProductCodesCount: (doc?.selectedProductCodes || []).length,
  isActive: !!doc?.isActive,
  notes: doc?.notes || "",
  lastUpdatedAt: doc?.lastUpdatedAt,
  lastUpdatedBy: doc?.lastUpdatedBy || "",
  createdAt: doc?.createdAt,
  updatedAt: doc?.updatedAt,
});

const buildItemXml = ({
  id,
  itemGroupId,
  title,
  desc,
  link,
  images,
  price,
  compareAtPrice,
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
  const extraImages = safeArr(images).slice(1, 10);

  return `<item>
<g:id>${esc(id)}</g:id>
${itemGroupId ? `<g:item_group_id>${esc(itemGroupId)}</g:item_group_id>` : ""}
<g:title>${esc(clamp(title, 150))}</g:title>
<g:description>${esc(clamp(desc, 5000))}</g:description>
<g:link>${esc(link)}</g:link>
${mainImage ? `<g:image_link>${esc(mainImage)}</g:image_link>` : ""}
${extraImages
  .map((img) => `<g:additional_image_link>${esc(img)}</g:additional_image_link>`)
  .join("\n")}
<g:availability>in stock</g:availability>
<g:condition>new</g:condition>
<g:brand>${esc(BRAND)}</g:brand>
${
  googleProductCategory
    ? `<g:google_product_category>${esc(
        googleProductCategory
      )}</g:google_product_category>`
    : ""
}
${productTypePath ? `<g:product_type>${esc(productTypePath)}</g:product_type>` : ""}
${customLabel0 ? `<g:custom_label_0>${esc(customLabel0)}</g:custom_label_0>` : ""}
<g:color>${esc(color || "NA")}</g:color>
<g:size>${esc(size || "NA")}</g:size>
<g:gender>${META_GENDER}</g:gender>
<g:age_group>${META_AGE_GROUP}</g:age_group>
${
  hasSale
    ? `<g:price>${esc(fmtMoney(compareAtPrice))}</g:price>
<g:sale_price>${esc(fmtMoney(price))}</g:sale_price>`
    : `<g:price>${esc(fmtMoney(price))}</g:price>`
}
${gtin ? `<g:gtin>${esc(gtin)}</g:gtin>` : ""}
${mpn ? `<g:mpn>${esc(mpn)}</g:mpn>` : ""}
<g:inventory>${META_INVENTORY}</g:inventory>
</item>`;
};

const buildXml = (itemsXml = "") => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${esc("Oatclub Commerce Manager Feed")}</title>
<link>${esc(SITE_BASE)}</link>
<description>${esc("Selected products feed for Meta Commerce Manager.")}</description>
${itemsXml}
</channel>
</rss>`;

let xmlCache = {
  xml: "",
  etag: "",
  expiresAt: 0,
  meta: { count: 0, builtAt: null },
};

const setXmlCache = (xml, count = 0) => {
  const now = Date.now();

  xmlCache = {
    xml,
    etag: `W/"${xml.length}-${now}"`,
    expiresAt: now + CACHE_TTL_MS,
    meta: { count, builtAt: new Date(now).toISOString() },
  };

  return xmlCache;
};

const invalidateXmlCache = () => {
  xmlCache.expiresAt = 0;
};

async function rebuildCommerceManagerXml() {
  const config = await CommerceManager.getSingleton();
  const selectedCodes = normalizeCodes(config?.selectedProductCodes);

  if (!selectedCodes.length) return setXmlCache(buildXml(""), 0);

  const selectedSet = new Set([
    ...selectedCodes,
    ...selectedCodes
      .map((code) => Number(code))
      .filter((n) => !Number.isNaN(n))
      .map((n) => String(n)),
  ]);

  const now = new Date();

  const allProducts = await Product.find({
    isActive: true,
    isDraft: false,
    $or: [
      { publishAt: { $exists: false } },
      { publishAt: null },
      { publishAt: { $lte: now } },
    ],
  })
    .select(
      [
        "productCode",
        "code",
        "sku",
        "productDetails",
        "title",
        "slug",
        "shortDescription",
        "howToStyle",
        "specifications",
        "categories",
        "colors",
        "thumbnail",
        "images",
        "price",
        "compareAtPrice",
        "productType",
        "variants.sku",
        "variants.code",
        "variants.barcode",
        "variants.attributes",
        "updatedAt",
      ].join(" ")
    )
    .sort({ updatedAt: -1 })
    .lean();

  const products = allProducts.filter((product) =>
    getPossibleCodes(product).some((code) => selectedSet.has(code))
  );

  const items = [];

  for (const product of products) {
    const productId = String(product?._id || "").trim();
    const title = String(product?.title || "").trim();
    const desc =
      String(product?.shortDescription || "").trim() ||
      String(product?.howToStyle || "").trim() ||
      "";

    const images = pickImages(product);
    const link = buildLink(product);

    const cats = safeArr(product?.categories)
      .map((c) => String(c || "").trim())
      .filter(Boolean);

    const productTypePath = cats.join(" > ");
    const googleProductCategory = getGoogleProductCategory(cats);
    const customLabel0 = cats[0] || "";

    const isVariable =
      product?.productType === "variable" || safeArr(product?.variants).length > 0;

    if (isVariable && safeArr(product?.variants).length) {
      for (const variant of product.variants) {
        const sku = String(variant?.sku || "").trim();
        const variantId = String(variant?._id || "").trim();
        const rawGtin = String(variant?.barcode || "").trim();

        items.push(
          buildItemXml({
            id: sku || `${productId}-${variantId}`,
            itemGroupId: productId,
            title,
            desc,
            link,
            images,
            price: product?.price,
            compareAtPrice: product?.compareAtPrice,
            color: getProductColor(product, variant),
            size: getAttr(variant?.attributes, "size") || "NA",
            gtin: looksLikeGTIN(rawGtin) ? rawGtin : "",
            mpn: sku || product?.productCode || "",
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
          price: product?.price,
          compareAtPrice: product?.compareAtPrice,
          color: getProductColor(product),
          size: "NA",
          gtin: "",
          mpn: product?.sku || product?.productCode || "",
          productTypePath,
          googleProductCategory,
          customLabel0,
        })
      );
    }
  }

  return setXmlCache(buildXml(items.join("\n")), items.length);
}

async function getCommerceManagerXml(force = false) {
  if (!force && xmlCache.xml && xmlCache.expiresAt > Date.now()) return xmlCache;
  return rebuildCommerceManagerXml();
}

export const getCommerceManagerConfig = async (req, res) => {
  try {
    const doc = await CommerceManager.getSingleton();
    return res.status(200).json({ success: true, data: toSafeResponse(doc) });
  } catch (error) {
    console.error("getCommerceManagerConfig error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load commerce manager config",
    });
  }
};

export const upsertCommerceManagerConfig = async (req, res) => {
  try {
    const { selectedProductCodes, isActive, notes, lastUpdatedBy } = req.body;

    const doc = await CommerceManager.getSingleton();

    if (selectedProductCodes !== undefined) {
      doc.selectedProductCodes = normalizeCodes(selectedProductCodes);
    }

    if (typeof isActive === "boolean") {
      doc.isActive = isActive;
    }

    if (notes !== undefined) {
      doc.notes = String(notes ?? "").trim();
    }

    doc.touch(lastUpdatedBy);
    await doc.save();
    invalidateXmlCache();

    return res.status(200).json({
      success: true,
      message: "Commerce manager config updated successfully",
      data: toSafeResponse(doc),
    });
  } catch (error) {
    console.error("upsertCommerceManagerConfig error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update commerce manager config",
    });
  }
};

export const addCommerceManagerProductCodes = async (req, res) => {
  try {
    const { productCodes = [], lastUpdatedBy = "" } = req.body;
    const incomingCodes = normalizeCodes(productCodes);

    if (!incomingCodes.length) {
      return res.status(400).json({
        success: false,
        message: "productCodes are required",
      });
    }

    const doc = await CommerceManager.getSingleton();
    doc.selectedProductCodes = normalizeCodes([
      ...(doc.selectedProductCodes || []),
      ...incomingCodes,
    ]);

    doc.touch(lastUpdatedBy);
    await doc.save();
    invalidateXmlCache();

    return res.status(200).json({
      success: true,
      message: "Product codes added successfully",
      data: toSafeResponse(doc),
    });
  } catch (error) {
    console.error("addCommerceManagerProductCodes error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add product codes",
    });
  }
};

export const removeCommerceManagerProductCodes = async (req, res) => {
  try {
    const { productCodes = [], lastUpdatedBy = "" } = req.body;
    const removeCodes = new Set(normalizeCodes(productCodes));

    if (!removeCodes.size) {
      return res.status(400).json({
        success: false,
        message: "productCodes are required",
      });
    }

    const doc = await CommerceManager.getSingleton();
    doc.selectedProductCodes = (doc.selectedProductCodes || []).filter(
      (code) => !removeCodes.has(normalizeCode(code))
    );

    doc.touch(lastUpdatedBy);
    await doc.save();
    invalidateXmlCache();

    return res.status(200).json({
      success: true,
      message: "Product codes removed successfully",
      data: toSafeResponse(doc),
    });
  } catch (error) {
    console.error("removeCommerceManagerProductCodes error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to remove product codes",
    });
  }
};

export const clearCommerceManagerProductCodes = async (req, res) => {
  try {
    const { lastUpdatedBy = "" } = req.body;

    const doc = await CommerceManager.getSingleton();
    doc.selectedProductCodes = [];
    doc.touch(lastUpdatedBy);

    await doc.save();
    invalidateXmlCache();

    return res.status(200).json({
      success: true,
      message: "All product codes cleared successfully",
      data: toSafeResponse(doc),
    });
  } catch (error) {
    console.error("clearCommerceManagerProductCodes error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to clear product codes",
    });
  }
};

export const toggleCommerceManagerStatus = async (req, res) => {
  try {
    const { isActive, lastUpdatedBy = "" } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be true or false",
      });
    }

    const doc = await CommerceManager.getSingleton();
    doc.isActive = isActive;
    doc.touch(lastUpdatedBy);

    await doc.save();
    invalidateXmlCache();

    return res.status(200).json({
      success: true,
      message: `Commerce manager ${
        isActive ? "activated" : "deactivated"
      } successfully`,
      data: toSafeResponse(doc),
    });
  } catch (error) {
    console.error("toggleCommerceManagerStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to toggle commerce manager status",
    });
  }
};

export const getCommerceManagerXmlFeed = async (req, res) => {
  try {
    const feed = await getCommerceManagerXml(false);

    if (req.headers["if-none-match"] === feed.etag) {
      return res.status(304).end();
    }

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=1800");
    res.setHeader("ETag", feed.etag);

    return res.status(200).send(feed.xml);
  } catch (error) {
    console.error("getCommerceManagerXmlFeed error:", error);
    return res.status(500).send("Commerce manager XML generation failed");
  }
};

export const refreshCommerceManagerXmlFeed = async (req, res) => {
  try {
    const feed = await getCommerceManagerXml(true);
    return res.status(200).json({
      success: true,
      count: feed.meta.count,
      builtAt: feed.meta.builtAt,
    });
  } catch (error) {
    console.error("refreshCommerceManagerXmlFeed error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to refresh commerce manager XML",
    });
  }
};

export const getCommerceManagerXmlFeedStatus = async (req, res) => {
  return res.status(200).json({
    success: true,
    count: xmlCache.meta.count,
    builtAt: xmlCache.meta.builtAt,
    cached: !!xmlCache.xml,
    expiresAt: xmlCache.expiresAt,
  });
};