import mongoose from "mongoose";

import CommerceManager from "./CommerceManager.js";
import Product from "../Products/Products.js";

/* =========================================================
   CONFIG
========================================================= */

const SITE_BASE = "https://www.oatclub.in";
const BRAND = "OATCLUB";
const CURRENCY = "INR";
const CACHE_TTL_MS = 30 * 60 * 1000;

const PRODUCT_SELECT = [
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
  "isActive",
  "isDraft",
  "publishAt",
  "variants._id",
  "variants.sku",
  "variants.code",
  "variants.barcode",
  "variants.attributes",
  "variants.price",
  "variants.compareAtPrice",
  "variants.inventory",
  "variants.stock",
  "variants.quantity",
  "updatedAt",
].join(" ");

/* =========================================================
   HELPERS
========================================================= */

const safeArr = (value) =>
  Array.isArray(value) ? value : [];

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

const normalizeSlug = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

const normalizeCodes = (codes) =>
  Array.isArray(codes)
    ? [...new Set(codes.map(normalizeCode).filter(Boolean))]
    : [];

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const clamp = (value, max) => {
  const text = String(value ?? "").trim();
  return text.length > max
    ? text.slice(0, max).trim()
    : text;
};

const money = (value) =>
  `${Number(value || 0).toFixed(2)} ${CURRENCY}`;

const getAttr = (attributes, key) => {
  const wanted = String(key || "")
    .trim()
    .toLowerCase();

  const row = safeArr(attributes).find(
    (item) =>
      String(item?.key || "")
        .trim()
        .toLowerCase() === wanted,
  );

  return String(row?.value || "").trim();
};

const firstNonEmpty = (...values) =>
  values
    .map((value) => String(value ?? "").trim())
    .find(Boolean) || "";

/* =========================================================
   GTIN
========================================================= */

const validGTIN = (value) => {
  const gtin = String(value || "")
    .replace(/\D/g, "");

  if (![8, 12, 13, 14].includes(gtin.length)) {
    return false;
  }

  const digits = gtin.split("").map(Number);
  const checkDigit = digits.pop();

  let sum = 0;
  let multiplier = 3;

  for (let i = digits.length - 1; i >= 0; i -= 1) {
    sum += digits[i] * multiplier;
    multiplier = multiplier === 3 ? 1 : 3;
  }

  return (10 - (sum % 10)) % 10 === checkDigit;
};

/* =========================================================
   PRODUCT DATA
========================================================= */

const categoryName = (category) => {
  if (!category) return "";

  if (typeof category === "string") {
    return category.trim();
  }

  return String(
    category?.name ||
    category?.title ||
    category?.slug ||
    "",
  ).trim();
};

const getCategories = (product) =>
  safeArr(product?.categories)
    .map(categoryName)
    .filter(Boolean);

const pickImages = (product, settings) => {
  const output = [];

  const add = (value) => {
    const url =
      typeof value === "string"
        ? value.trim()
        : String(
          value?.url ||
          value?.secure_url ||
          value?.src ||
          value?.imageUrl ||
          "",
        ).trim();

    if (url && !output.includes(url)) {
      output.push(url);
    }
  };

  add(product?.thumbnail);

  safeArr(product?.images).forEach(add);

  const maxAdditional = Math.min(
    10,
    Math.max(
      0,
      Number(settings?.maxAdditionalImages ?? 10),
    ),
  );

  if (settings?.includeAdditionalImages === false) {
    return output.slice(0, 1);
  }

  return output.slice(0, maxAdditional + 1);
};

const buildProductLink = (product) => {
  const categories = getCategories(product);

  const category =
    normalizeSlug(categories[0]) || "products";

  const slug = String(product?.slug || "").trim();
  const id = String(product?._id || "").trim();

  return `${SITE_BASE}/category/${encodeURIComponent(
    category,
  )}/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`;
};

const getProductColor = (product, variant = null) => {
  const variantColor = getAttr(
    variant?.attributes,
    "color",
  );

  const productColor = safeArr(product?.colors)
    .map((color) =>
      typeof color === "string"
        ? color.trim()
        : String(
          color?.name ||
          color?.value ||
          color?.title ||
          "",
        ).trim(),
    )
    .find(Boolean);

  const specColor = safeArr(
    product?.specifications,
  ).find(
    (item) =>
      String(item?.key || "")
        .trim()
        .toLowerCase() === "color",
  )?.value;

  return firstNonEmpty(
    variantColor,
    productColor,
    specColor,
  );
};

/* =========================================================
   GOOGLE CATEGORY
========================================================= */

const getGoogleProductCategory = (categories = []) => {
  const category = String(
    categories?.[0] || "",
  ).toLowerCase();

  if (
    /(top|tshirt|t-shirt|tee|shirt|blouse|crop|corset|tank)/.test(
      category,
    )
  ) {
    return "Apparel & Accessories > Clothing > Shirts & Tops";
  }

  if (/(dress|gown)/.test(category)) {
    return "Apparel & Accessories > Clothing > Dresses";
  }

  if (
    /(trouser|pant|jean|bottom|legging)/.test(
      category,
    )
  ) {
    return "Apparel & Accessories > Clothing > Pants";
  }

  if (/skirt/.test(category)) {
    return "Apparel & Accessories > Clothing > Skirts";
  }

  if (
    /(jacket|coat|blazer|hoodie|sweatshirt)/.test(
      category,
    )
  ) {
    return "Apparel & Accessories > Clothing > Outerwear";
  }

  if (
    /(shoe|footwear|heel|sneaker|boot|sandal)/.test(
      category,
    )
  ) {
    return "Apparel & Accessories > Shoes";
  }

  if (/(bag|handbag|purse)/.test(category)) {
    return "Apparel & Accessories > Handbags, Wallets & Cases > Handbags";
  }

  if (
    /(accessor|belt|cap|hat|sunglass|scarf)/.test(
      category,
    )
  ) {
    return "Apparel & Accessories > Clothing Accessories";
  }

  return "Apparel & Accessories";
};

/* =========================================================
   INVENTORY / AVAILABILITY
========================================================= */

const getActualInventory = (item) => {
  const value =
    item?.availableQuantity ??
    item?.inventory ??
    item?.stock ??
    item?.quantity ??
    0;

  const number = Number(value);

  return Number.isFinite(number)
    ? Math.max(0, number)
    : 0;
};

const getAvailability = (item, settings) => {
  /*
   * OATCLUB made-to-order behaviour:
   *
   * forceInStock = true
   * Google gets:
   * <g:availability>in_stock</g:availability>
   *
   * We intentionally DO NOT send:
   * <g:inventory>999999</g:inventory>
   */
  if (settings.forceInStock) {
    return "in_stock";
  }

  return getActualInventory(item) > 0
    ? "in_stock"
    : "out_of_stock";
};

/* =========================================================
   FEED SETTINGS
========================================================= */

const getSettings = (doc) => {
  const settings = doc?.feedSettings || {};

  return {
    title:
      String(settings.title || "").trim() ||
      `${doc?.name || "OATCLUB"} Google Merchant Feed`,

    description:
      String(settings.description || "").trim() ||
      "OATCLUB product feed for Google Merchant Center.",

    forceInStock:
      typeof settings.forceInStock === "boolean"
        ? settings.forceInStock
        : true,

    includeOutOfStock: Boolean(
      settings.includeOutOfStock,
    ),

    includeInactiveProducts: Boolean(
      settings.includeInactiveProducts,
    ),

    includeAdditionalImages:
      settings.includeAdditionalImages !== false,

    maxAdditionalImages: Math.min(
      10,
      Math.max(
        0,
        Number(settings.maxAdditionalImages ?? 10),
      ),
    ),

    customLabel0: String(
      settings.customLabel0 || "",
    ).trim(),

    customLabel1: String(
      settings.customLabel1 || "",
    ).trim(),
  };
};

/* =========================================================
   PRODUCT CODE MATCHING
========================================================= */

const getPossibleCodes = (product) => {
  const codes = new Set();

  const add = (value) => {
    const raw = String(value ?? "").trim();

    if (!raw) return;

    const normalized = normalizeCode(raw);

    if (normalized) {
      codes.add(normalized);
    }

    const parts = raw.match(/\d+/g) || [];

    parts.forEach((part) => {
      codes.add(normalizeCode(part));

      const number = Number(part);

      if (!Number.isNaN(number)) {
        codes.add(String(number));
      }
    });

    const number = Number(raw);

    if (!Number.isNaN(number)) {
      codes.add(String(number));
    }
  };

  add(product?.productCode);
  add(product?.code);
  add(product?.sku);
  add(product?.productDetails?.productCode);
  add(product?.productDetails?.code);

  safeArr(product?.variants).forEach((variant) => {
    add(variant?.sku);
    add(variant?.code);
  });

  return [...codes];
};

const buildSelectedSet = (codes) =>
  new Set([
    ...codes,

    ...codes
      .map(Number)
      .filter((value) => !Number.isNaN(value))
      .map(String),
  ]);

/* =========================================================
   DB HELPERS
========================================================= */

const getProductQuery = (settings) => {
  if (settings.includeInactiveProducts) {
    return {};
  }

  const now = new Date();

  return {
    isActive: true,
    isDraft: false,

    $or: [
      {
        publishAt: {
          $exists: false,
        },
      },
      {
        publishAt: null,
      },
      {
        publishAt: {
          $lte: now,
        },
      },
    ],
  };
};

const findFeed = async (
  identifier = "default",
  activeOnly = true,
) => {
  const query = {
    platform: "google",
  };

  if (
    identifier &&
    identifier !== "default"
  ) {
    const filters = [];

    if (
      mongoose.Types.ObjectId.isValid(identifier)
    ) {
      filters.push({
        _id: identifier,
      });
    }

    const slug = normalizeSlug(identifier);

    if (slug) {
      filters.push({
        slug,
      });
    }

    if (!filters.length) {
      return null;
    }

    query.$or = filters;
  }

  if (activeOnly) {
    query.isActive = true;
  }

  return CommerceManager.findOne(query)
    .sort({
      isDefault: -1,
      createdAt: 1,
    });
};

/* =========================================================
   XML ITEM
========================================================= */

const buildItemXml = ({
  id,
  itemGroupId,
  title,
  description,
  link,
  images,
  availability,
  price,
  salePrice,
  gtin,
  mpn,
  color,
  size,
  productType,
  googleCategory,
  customLabel0,
  customLabel1,
}) => {
  const mainImage = images?.[0] || "";
  const additionalImages = safeArr(images).slice(1, 11);

  const normalPrice = Number(price);
  const discountedPrice = Number(salePrice);

  const hasSale =
    Number.isFinite(normalPrice) &&
    Number.isFinite(discountedPrice) &&
    normalPrice > discountedPrice &&
    discountedPrice > 0;

  return `<item>
<g:id>${esc(id)}</g:id>
${itemGroupId ? `<g:item_group_id>${esc(itemGroupId)}</g:item_group_id>` : ""}
<g:title>${esc(clamp(title, 150))}</g:title>
<g:description>${esc(clamp(description, 5000))}</g:description>
<g:link>${esc(link)}</g:link>
<g:image_link>${esc(mainImage)}</g:image_link>
${additionalImages
      .map(
        (image) =>
          `<g:additional_image_link>${esc(image)}</g:additional_image_link>`,
      )
      .join("\n")}
<g:availability>${availability}</g:availability>
<g:condition>new</g:condition>
<g:brand>${esc(BRAND)}</g:brand>
${googleCategory
      ? `<g:google_product_category>${esc(
        googleCategory,
      )}</g:google_product_category>`
      : ""
    }
${productType
      ? `<g:product_type>${esc(productType)}</g:product_type>`
      : ""
    }
${customLabel0
      ? `<g:custom_label_0>${esc(customLabel0)}</g:custom_label_0>`
      : ""
    }
${customLabel1
      ? `<g:custom_label_1>${esc(customLabel1)}</g:custom_label_1>`
      : ""
    }
${hasSale
      ? `<g:price>${esc(money(normalPrice))}</g:price>
<g:sale_price>${esc(money(discountedPrice))}</g:sale_price>`
      : `<g:price>${esc(
        money(
          Number.isFinite(discountedPrice) &&
            discountedPrice > 0
            ? discountedPrice
            : normalPrice,
        ),
      )}</g:price>`
    }
${gtin ? `<g:gtin>${esc(gtin)}</g:gtin>` : ""}
${mpn ? `<g:mpn>${esc(mpn)}</g:mpn>` : ""}
${color ? `<g:color>${esc(color)}</g:color>` : ""}
${size ? `<g:size>${esc(size)}</g:size>` : ""}
<g:gender>female</g:gender>
<g:age_group>adult</g:age_group>
</item>`;
};

/* =========================================================
   XML DOCUMENT
========================================================= */

const buildXml = ({
  title,
  description,
  items,
}) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${esc(title)}</title>
<link>${esc(SITE_BASE)}</link>
<description>${esc(description)}</description>
${items.join("\n")}
</channel>
</rss>`;

/* =========================================================
   CACHE
========================================================= */

const cache = new Map();

const cacheKey = (doc) =>
  String(
    doc?._id ||
    doc?.slug ||
    "default",
  );

const clearCache = (doc = null) => {
  if (!doc) {
    cache.clear();
    return;
  }

  cache.delete(cacheKey(doc));
  cache.delete(normalizeSlug(doc?.slug));
};

const getCached = (doc) => {
  const entry =
    cache.get(cacheKey(doc)) ||
    cache.get(normalizeSlug(doc?.slug));

  if (
    !entry ||
    entry.expiresAt <= Date.now()
  ) {
    return null;
  }

  return entry;
};

const saveCache = (doc, xml, count) => {
  const now = Date.now();

  const entry = {
    xml,
    count,
    builtAt: new Date(now).toISOString(),
    expiresAt: now + CACHE_TTL_MS,
    etag: `W/"google-${Buffer.byteLength(
      xml,
      "utf8",
    )}-${now}"`,
  };

  cache.set(cacheKey(doc), entry);

  if (doc?.slug) {
    cache.set(
      normalizeSlug(doc.slug),
      entry,
    );
  }

  return entry;
};

/* =========================================================
   BUILD GOOGLE FEED
========================================================= */

const rebuildGoogleFeed = async (doc) => {
  const settings = getSettings(doc);

  const selectedCodes = normalizeCodes(
    doc?.selectedProductCodes,
  );

  if (
    !doc?.isActive ||
    !selectedCodes.length
  ) {
    const xml = buildXml({
      title: settings.title,
      description: settings.description,
      items: [],
    });

    return saveCache(doc, xml, 0);
  }

  const selectedSet =
    buildSelectedSet(selectedCodes);

  const allProducts = await Product.find(
    getProductQuery(settings),
  )
    .select(PRODUCT_SELECT)
    .sort({
      updatedAt: -1,
    })
    .lean();

  const products = allProducts.filter(
    (product) =>
      getPossibleCodes(product).some(
        (code) => selectedSet.has(code),
      ),
  );

  const items = [];

  for (const product of products) {
    const productId = String(
      product?._id || "",
    );

    const parentCode = firstNonEmpty(
      product?.productCode,
      product?.code,
      product?.sku,
      productId,
    );

    const title = String(
      product?.title || "",
    ).trim();

    const description = firstNonEmpty(
      product?.shortDescription,
      product?.howToStyle,
      title,
    );

    const images = pickImages(
      product,
      settings,
    );

    const link = buildProductLink(product);

    /*
     * Required basic Google fields.
     * Don't send broken products to Merchant Center.
     */
    if (
      !title ||
      !images.length ||
      !link
    ) {
      continue;
    }

    const categories =
      getCategories(product);

    const productType =
      categories.join(" > ");

    const googleCategory =
      getGoogleProductCategory(categories);

    const customLabel0 =
      settings.customLabel0 ||
      categories[0] ||
      "";

    const customLabel1 =
      settings.customLabel1 ||
      doc?.slug ||
      "";

    const variants =
      safeArr(product?.variants);

    /* -----------------------------------------------------
       VARIANT PRODUCT
    ----------------------------------------------------- */

    if (variants.length) {
      for (const variant of variants) {
        const availability =
          getAvailability(
            variant,
            settings,
          );

        if (
          availability === "out_of_stock" &&
          !settings.includeOutOfStock
        ) {
          continue;
        }

        const sellingPrice = Number(
          variant?.price ??
          product?.price ??
          0,
        );

        const compareAtPrice = Number(
          variant?.compareAtPrice ??
          product?.compareAtPrice ??
          0,
        );

        if (
          !Number.isFinite(sellingPrice) ||
          sellingPrice <= 0
        ) {
          continue;
        }

        const sku = firstNonEmpty(
          variant?.sku,
          variant?.code,
        );

        const variantId = String(
          variant?._id || "",
        );

        const id =
          sku ||
          `${parentCode}-${variantId}`;

        const barcode = String(
          variant?.barcode || "",
        ).trim();

        const gtin = validGTIN(barcode)
          ? barcode.replace(/\D/g, "")
          : "";

        const size = getAttr(
          variant?.attributes,
          "size",
        );

        const color =
          getProductColor(
            product,
            variant,
          );

        items.push(
          buildItemXml({
            id,

            itemGroupId:
              parentCode,

            title,
            description,
            link,
            images,
            availability,

            /*
             * Google sale logic:
             * compareAt = original price
             * sellingPrice = sale price
             */
            price:
              compareAtPrice > sellingPrice
                ? compareAtPrice
                : sellingPrice,

            salePrice:
              compareAtPrice > sellingPrice
                ? sellingPrice
                : null,

            gtin,

            /*
             * OATCLUB is the manufacturer/brand,
             * so our own SKU/product code can act
             * as manufacturer part identifier.
             */
            mpn:
              sku ||
              `${parentCode}-${size || variantId}`,

            color,
            size,

            productType,
            googleCategory,
            customLabel0,
            customLabel1,
          }),
        );
      }

      continue;
    }

    /* -----------------------------------------------------
       SIMPLE PRODUCT
    ----------------------------------------------------- */

    const availability =
      getAvailability(
        product,
        settings,
      );

    if (
      availability === "out_of_stock" &&
      !settings.includeOutOfStock
    ) {
      continue;
    }

    const sellingPrice = Number(
      product?.price || 0,
    );

    const compareAtPrice = Number(
      product?.compareAtPrice || 0,
    );

    if (
      !Number.isFinite(sellingPrice) ||
      sellingPrice <= 0
    ) {
      continue;
    }

    items.push(
      buildItemXml({
        id: parentCode,

        itemGroupId: "",

        title,
        description,
        link,
        images,
        availability,

        price:
          compareAtPrice > sellingPrice
            ? compareAtPrice
            : sellingPrice,

        salePrice:
          compareAtPrice > sellingPrice
            ? sellingPrice
            : null,

        gtin: "",

        mpn: parentCode,

        color:
          getProductColor(product),

        size: "",

        productType,
        googleCategory,
        customLabel0,
        customLabel1,
      }),
    );
  }

  const xml = buildXml({
    title: settings.title,
    description: settings.description,
    items,
  });

  return saveCache(
    doc,
    xml,
    items.length,
  );
};

const getGoogleFeed = async (
  doc,
  force = false,
) => {
  if (!force) {
    const existing =
      getCached(doc);

    if (existing) {
      return existing;
    }
  }

  return rebuildGoogleFeed(doc);
};

/* =========================================================
   XML RESPONSE
========================================================= */

const sendFeed = async ({
  req,
  res,
  doc,
  force = false,
}) => {
  const feed = await getGoogleFeed(
    doc,
    force,
  );

  if (
    req.headers["if-none-match"] ===
    feed.etag
  ) {
    return res.status(304).end();
  }

  res.setHeader(
    "Content-Type",
    "application/xml; charset=utf-8",
  );

  res.setHeader(
    "Cache-Control",
    "public, max-age=1800, stale-while-revalidate=300",
  );

  res.setHeader(
    "ETag",
    feed.etag,
  );

  res.setHeader(
    "X-Google-Merchant-Feed",
    doc?.slug || "default",
  );

  res.setHeader(
    "X-Google-Merchant-Items",
    String(feed.count),
  );

  return res
    .status(200)
    .send(feed.xml);
};

/* =========================================================
   GET DEFAULT GOOGLE XML

   GET /api/google-merchant/xml
========================================================= */

export const getGoogleMerchantXmlFeed =
  async (req, res) => {
    try {
      const doc =
        await findFeed(
          "default",
          true,
        );

      if (!doc) {
        return res
          .status(404)
          .type("application/xml")
          .send(
            '<?xml version="1.0" encoding="UTF-8"?><error><message>Google Merchant feed is inactive</message></error>',
          );
      }

      return sendFeed({
        req,
        res,
        doc,
      });
    } catch (error) {
      console.error(
        "getGoogleMerchantXmlFeed:",
        error,
      );

      return res
        .status(500)
        .type("application/xml")
        .send(
          '<?xml version="1.0" encoding="UTF-8"?><error><message>Google Merchant XML generation failed</message></error>',
        );
    }
  };

/* =========================================================
   GET GOOGLE XML BY SLUG

   GET /api/google-merchant/xml/:slug
========================================================= */

export const getGoogleMerchantXmlFeedBySlug =
  async (req, res) => {
    try {
      const slug = normalizeSlug(
        req.params.slug,
      );

      if (!slug) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Valid feed slug is required",
          });
      }

      const doc =
        await findFeed(
          slug,
          true,
        );

      if (!doc) {
        return res
          .status(404)
          .type("application/xml")
          .send(
            '<?xml version="1.0" encoding="UTF-8"?><error><message>Google Merchant feed not found or inactive</message></error>',
          );
      }

      return sendFeed({
        req,
        res,
        doc,
      });
    } catch (error) {
      console.error(
        "getGoogleMerchantXmlFeedBySlug:",
        error,
      );

      return res
        .status(500)
        .type("application/xml")
        .send(
          '<?xml version="1.0" encoding="UTF-8"?><error><message>Google Merchant XML generation failed</message></error>',
        );
    }
  };

/* =========================================================
   REFRESH

   POST /api/google-merchant/xml/refresh
   POST /api/google-merchant/feeds/:id/xml/refresh
========================================================= */

export const refreshGoogleMerchantXmlFeed =
  async (req, res) => {
    try {
      const identifier =
        req.params.id ||
        req.params.slug ||
        "default";

      const doc =
        await findFeed(
          identifier,
          false,
        );

      if (!doc) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Commerce feed not found",
          });
      }

      const feed =
        await getGoogleFeed(
          doc,
          true,
        );

      return res.json({
        success: true,

        feed: {
          id: doc._id,
          name: doc.name,
          slug: doc.slug,
        },

        count: feed.count,
        builtAt: feed.builtAt,
      });
    } catch (error) {
      console.error(
        "refreshGoogleMerchantXmlFeed:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to refresh Google Merchant XML",
        });
    }
  };

/* =========================================================
   STATUS

   GET /api/google-merchant/xml/status
   GET /api/google-merchant/feeds/:id/xml/status
========================================================= */

export const getGoogleMerchantXmlStatus =
  async (req, res) => {
    try {
      const identifier =
        req.params.id ||
        req.params.slug ||
        "default";

      const doc =
        await findFeed(
          identifier,
          false,
        );

      if (!doc) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Commerce feed not found",
          });
      }

      const entry =
        getCached(doc);

      return res.json({
        success: true,

        feed: {
          id: doc._id,
          name: doc.name,
          slug: doc.slug,
          isActive:
            Boolean(doc.isActive),
        },

        cached: Boolean(entry),

        count:
          entry?.count || 0,

        builtAt:
          entry?.builtAt || null,

        expiresAt:
          entry?.expiresAt || 0,
      });
    } catch (error) {
      console.error(
        "getGoogleMerchantXmlStatus:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to get Google Merchant feed status",
        });
    }
  };

/* =========================================================
   CLEAR CACHE

   DELETE /api/google-merchant/xml/cache
   DELETE /api/google-merchant/feeds/:id/xml/cache
========================================================= */

export const clearGoogleMerchantXmlCache =
  async (req, res) => {
    try {
      const identifier =
        req.params.id ||
        req.params.slug ||
        "";

      if (!identifier) {
        clearCache();

        return res.json({
          success: true,
          message:
            "All Google Merchant XML cache cleared",
        });
      }

      const doc =
        await findFeed(
          identifier,
          false,
        );

      if (!doc) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Commerce feed not found",
          });
      }

      clearCache(doc);

      return res.json({
        success: true,
        message: `Google Merchant cache cleared for ${doc.name}`,
      });
    } catch (error) {
      console.error(
        "clearGoogleMerchantXmlCache:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to clear Google Merchant cache",
        });
    }
  };
