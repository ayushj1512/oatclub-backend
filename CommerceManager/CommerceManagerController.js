import mongoose from "mongoose";

import CommerceManager from "./CommerceManager.js";
import Product from "../Products/Products.js";

const SITE_BASE = "https://www.oatclub.in";
const API_BASE = "https://studio.oatclub.in/api/commerce-manager";
const BRAND = "Oatclub";
const CURRENCY = "INR";
const CACHE_TTL_MS = 55 * 60 * 1000;
const META_GENDER = "female";
const META_AGE_GROUP = "adult";
const DEFAULT_INVENTORY = 999999;

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

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

const normalizeCodes = (codes) =>
  Array.isArray(codes)
    ? [...new Set(codes.map(normalizeCode).filter(Boolean))]
    : [];

const normalizeSlug = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

const safeArr = (value) => (Array.isArray(value) ? value : []);

const safeObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const clamp = (value, limit) => {
  const text = String(value ?? "").trim();
  return text.length > limit ? text.slice(0, limit).trim() : text;
};

const slugify = (value) => normalizeSlug(value) || "products";

const fmtMoney = (value) =>
  `${(Number.isFinite(Number(value)) ? Number(value) : 0).toFixed(
    2,
  )} ${CURRENCY}`;

const looksLikeGTIN = (value) => {
  const text = String(value || "").trim();

  return (
    /^\d+$/.test(text) &&
    [8, 12, 13, 14].includes(text.length)
  );
};

const getAttr = (attributes, key) => {
  const wanted = String(key || "")
    .trim()
    .toLowerCase();

  const match = safeArr(attributes).find(
    (entry) =>
      String(entry?.key || "")
        .trim()
        .toLowerCase() === wanted,
  );

  return String(match?.value || "").trim();
};

const firstNonEmpty = (...values) => {
  for (const value of values) {
    const normalized = String(value ?? "").trim();

    if (normalized) {
      return normalized;
    }
  }

  return "";
};

const getRequestBaseUrl = (req) => {
  const forwardedProto = String(
    req.headers["x-forwarded-proto"] || "",
  )
    .split(",")[0]
    .trim();

  const protocol = forwardedProto || req.protocol || "https";
  const host = req.get("host");

  return host
    ? `${protocol}://${host}`
    : "https://studio.oatclub.in";
};

const buildFeedUrl = (req, doc) => {
  const baseUrl = getRequestBaseUrl(req);

  if (doc?.isDefault || doc?.slug === "default") {
    return `${baseUrl}/api/commerce-manager/xml`;
  }

  return `${baseUrl}/api/commerce-manager/xml/${encodeURIComponent(
    doc?.slug || "",
  )}`;
};

const pickImages = (product, settings = {}) => {
  const output = [];

  const thumbnail = String(
    product?.thumbnail || "",
  ).trim();

  if (thumbnail) {
    output.push(thumbnail);
  }

  for (const image of safeArr(product?.images)) {
    const url =
      typeof image === "string"
        ? image.trim()
        : String(
          image?.url ||
          image?.secure_url ||
          image?.src ||
          image?.imageUrl ||
          "",
        ).trim();

    if (url && !output.includes(url)) {
      output.push(url);
    }
  }

  if (settings.includeAdditionalImages === false) {
    return output.slice(0, 1);
  }

  const maxAdditionalImages = Math.max(
    0,
    Math.min(
      10,
      Number(settings.maxAdditionalImages ?? 10),
    ),
  );

  return output.slice(0, maxAdditionalImages + 1);
};

const buildLink = (product) => {
  const category = slugify(
    product?.categories?.[0],
  );

  const slug = String(product?.slug || "").trim();
  const id = String(product?._id || "").trim();

  return `${SITE_BASE}/category/${encodeURIComponent(
    category,
  )}/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`;
};

const getGoogleProductCategory = (categories = []) => {
  const firstCategory = String(
    categories?.[0] || "",
  )
    .trim()
    .toLowerCase();

  if (
    /(top|tshirt|tee|shirt|blouse|crop|corset|tank)/.test(
      firstCategory,
    )
  ) {
    return "Apparel & Accessories > Clothing > Shirts & Tops";
  }

  if (/(dress|gown)/.test(firstCategory)) {
    return "Apparel & Accessories > Clothing > Dresses";
  }

  if (
    /(trouser|pant|jeans|bottom)/.test(firstCategory)
  ) {
    return "Apparel & Accessories > Clothing > Pants";
  }

  if (/(skirt)/.test(firstCategory)) {
    return "Apparel & Accessories > Clothing > Skirts";
  }

  if (
    /(jacket|coat|blazer|hoodie|sweatshirt)/.test(
      firstCategory,
    )
  ) {
    return "Apparel & Accessories > Clothing > Outerwear";
  }

  if (
    /(footwear|shoe|heels|sneaker|boot|sandal)/.test(
      firstCategory,
    )
  ) {
    return "Apparel & Accessories > Shoes";
  }

  if (/(bag|handbag|purse)/.test(firstCategory)) {
    return "Apparel & Accessories > Handbags, Wallets & Cases > Handbags";
  }

  if (
    /(accessor|belt|cap|hat|sunglass|scarf)/.test(
      firstCategory,
    )
  ) {
    return "Apparel & Accessories > Clothing Accessories";
  }

  return "Apparel & Accessories";
};

const getProductColor = (product, variant = null) => {
  const variantColor = getAttr(
    variant?.attributes,
    "color",
  );

  const productColor =
    safeArr(product?.colors)
      .map((color) =>
        String(color || "").trim(),
      )
      .find(Boolean) || "";

  const specificationColor =
    safeArr(product?.specifications).find(
      (row) =>
        String(row?.key || "")
          .trim()
          .toLowerCase() === "color",
    )?.value || "";

  return firstNonEmpty(
    variantColor,
    productColor,
    specificationColor,
    "NA",
  );
};

const getPossibleCodes = (product) => {
  const codes = new Set();

  const pushCode = (value) => {
    const raw = String(value ?? "").trim();

    if (!raw) {
      return;
    }

    const normalized = normalizeCode(raw);

    if (normalized) {
      codes.add(normalized);
    }

    const numericValue = Number(raw);

    if (!Number.isNaN(numericValue)) {
      codes.add(String(numericValue));
    }

    const numericParts = raw.match(/\d+/g) || [];

    for (const part of numericParts) {
      codes.add(normalizeCode(part));

      const partNumber = Number(part);

      if (!Number.isNaN(partNumber)) {
        codes.add(String(partNumber));
      }
    }
  };

  pushCode(product?.productCode);
  pushCode(product?.code);
  pushCode(product?.sku);
  pushCode(product?.productDetails?.productCode);
  pushCode(product?.productDetails?.code);

  for (const variant of safeArr(
    product?.variants,
  )) {
    pushCode(variant?.sku);
    pushCode(variant?.code);
  }

  return [...codes];
};

const getFeedSettings = (doc) => {
  const settings = safeObject(doc?.feedSettings);

  return {
    title:
      String(settings.title || "").trim() ||
      `${doc?.name || "Oatclub"} Commerce Manager Feed`,

    description:
      String(settings.description || "").trim() ||
      "Selected products feed for Meta Commerce Manager.",

    forceInStock:
      typeof settings.forceInStock === "boolean"
        ? settings.forceInStock
        : true,

    forcedInventory: Math.max(
      0,
      Number(
        settings.forcedInventory ??
        DEFAULT_INVENTORY,
      ),
    ),

    includeOutOfStock: Boolean(
      settings.includeOutOfStock,
    ),

    includeInactiveProducts: Boolean(
      settings.includeInactiveProducts,
    ),

    includeAdditionalImages:
      typeof settings.includeAdditionalImages ===
        "boolean"
        ? settings.includeAdditionalImages
        : true,

    maxAdditionalImages: Math.max(
      0,
      Math.min(
        10,
        Number(
          settings.maxAdditionalImages ?? 10,
        ),
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

const getVariantInventory = (variant) => {
  const rawInventory =
    variant?.availableQuantity ??
    variant?.inventory ??
    variant?.stock ??
    variant?.quantity ??
    0;

  const inventory = Number(rawInventory);

  return Number.isFinite(inventory)
    ? Math.max(0, inventory)
    : 0;
};

const getInventoryDetails = (
  variant,
  settings,
) => {
  if (settings.forceInStock) {
    return {
      inventory: settings.forcedInventory,
      availability: "in stock",
    };
  }

  const inventory =
    getVariantInventory(variant);

  return {
    inventory,
    availability:
      inventory > 0
        ? "in stock"
        : "out of stock",
  };
};

const toSafeResponse = (doc, req = null) => ({
  _id: doc?._id,
  name: doc?.name,
  slug: doc?.slug,

  selectedProductCodes:
    doc?.selectedProductCodes || [],

  selectedProductCodesCount: (
    doc?.selectedProductCodes || []
  ).length,

  isActive: Boolean(doc?.isActive),
  isDefault: Boolean(doc?.isDefault),

  notes: doc?.notes || "",

  feedSettings: getFeedSettings(doc),

  xmlUrl: req
    ? buildFeedUrl(req, doc)
    : `${API_BASE}/xml/${doc?.slug}`,

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
  customLabel1,
  availability,
  inventory,
}) => {
  const normalizedPrice = Number(price);

  const normalizedCompareAtPrice =
    Number(compareAtPrice);

  const hasSale =
    Number.isFinite(
      normalizedCompareAtPrice,
    ) &&
    Number.isFinite(normalizedPrice) &&
    normalizedCompareAtPrice >
    normalizedPrice;

  const mainImage = images?.[0] || "";

  const extraImages = safeArr(images).slice(
    1,
    11,
  );

  return `<item>
<g:id>${esc(id)}</g:id>
${itemGroupId
      ? `<g:item_group_id>${esc(
        itemGroupId,
      )}</g:item_group_id>`
      : ""
    }
<g:title>${esc(clamp(title, 150))}</g:title>
<g:description>${esc(
      clamp(desc, 5000),
    )}</g:description>
<g:link>${esc(link)}</g:link>
${mainImage
      ? `<g:image_link>${esc(
        mainImage,
      )}</g:image_link>`
      : ""
    }
${extraImages
      .map(
        (image) =>
          `<g:additional_image_link>${esc(
            image,
          )}</g:additional_image_link>`,
      )
      .join("\n")}
<g:availability>${esc(
        availability,
      )}</g:availability>
<g:condition>new</g:condition>
<g:brand>${esc(BRAND)}</g:brand>
${googleProductCategory
      ? `<g:google_product_category>${esc(
        googleProductCategory,
      )}</g:google_product_category>`
      : ""
    }
${productTypePath
      ? `<g:product_type>${esc(
        productTypePath,
      )}</g:product_type>`
      : ""
    }
${customLabel0
      ? `<g:custom_label_0>${esc(
        customLabel0,
      )}</g:custom_label_0>`
      : ""
    }
${customLabel1
      ? `<g:custom_label_1>${esc(
        customLabel1,
      )}</g:custom_label_1>`
      : ""
    }
<g:color>${esc(color || "NA")}</g:color>
<g:size>${esc(size || "NA")}</g:size>
<g:gender>${META_GENDER}</g:gender>
<g:age_group>${META_AGE_GROUP}</g:age_group>
${hasSale
      ? `<g:price>${esc(
        fmtMoney(
          normalizedCompareAtPrice,
        ),
      )}</g:price>
<g:sale_price>${esc(
        fmtMoney(normalizedPrice),
      )}</g:sale_price>`
      : `<g:price>${esc(
        fmtMoney(normalizedPrice),
      )}</g:price>`
    }
${gtin
      ? `<g:gtin>${esc(gtin)}</g:gtin>`
      : ""
    }
${mpn
      ? `<g:mpn>${esc(mpn)}</g:mpn>`
      : ""
    }
<g:inventory>${esc(
      inventory,
    )}</g:inventory>
</item>`;
};

const buildXml = ({
  title,
  description,
  itemsXml = "",
}) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${esc(title)}</title>
<link>${esc(SITE_BASE)}</link>
<description>${esc(description)}</description>
${itemsXml}
</channel>
</rss>`;

const xmlCache = new Map();

const getCacheKey = (docOrSlug) => {
  if (typeof docOrSlug === "string") {
    return (
      normalizeSlug(docOrSlug) || "default"
    );
  }

  return String(
    docOrSlug?._id ||
    docOrSlug?.slug ||
    "default",
  );
};

const createCacheEntry = (
  xml,
  count,
  doc,
) => {
  const now = Date.now();

  return {
    xml,

    etag: `W/"${Buffer.byteLength(
      xml,
      "utf8",
    )}-${now}"`,

    expiresAt: now + CACHE_TTL_MS,

    meta: {
      feedId: String(doc?._id || ""),
      slug: doc?.slug || "default",
      name:
        doc?.name || "Default Feed",
      count,
      builtAt: new Date(
        now,
      ).toISOString(),
    },
  };
};

const setXmlCache = (
  doc,
  xml,
  count = 0,
) => {
  const entry = createCacheEntry(
    xml,
    count,
    doc,
  );

  xmlCache.set(
    getCacheKey(doc),
    entry,
  );

  xmlCache.set(
    normalizeSlug(doc?.slug) ||
    "default",
    entry,
  );

  if (
    doc?.isDefault ||
    doc?.slug === "default"
  ) {
    xmlCache.set("default", entry);
  }

  return entry;
};

const invalidateXmlCache = (
  docOrSlug = null,
) => {
  if (!docOrSlug) {
    xmlCache.clear();
    return;
  }

  const key = getCacheKey(docOrSlug);

  xmlCache.delete(key);

  if (typeof docOrSlug !== "string") {
    xmlCache.delete(
      normalizeSlug(docOrSlug?.slug),
    );
  }
};

const getCachedXml = (doc) => {
  const cache =
    xmlCache.get(getCacheKey(doc)) ||
    xmlCache.get(
      normalizeSlug(doc?.slug),
    ) ||
    null;

  if (
    !cache ||
    !cache.xml ||
    cache.expiresAt <= Date.now()
  ) {
    return null;
  }

  return cache;
};

const buildSelectedCodeSet = (
  selectedCodes,
) =>
  new Set([
    ...selectedCodes,

    ...selectedCodes
      .map((code) => Number(code))
      .filter(
        (number) =>
          !Number.isNaN(number),
      )
      .map((number) => String(number)),
  ]);

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

const findFeedByIdentifier = async (
  identifier,
  options = {},
) => {
  const { activeOnly = false } =
    options;

  if (
    !identifier ||
    identifier === "default"
  ) {
    const doc =
      await CommerceManager.getSingleton();

    if (
      activeOnly &&
      !doc?.isActive
    ) {
      return null;
    }

    return doc;
  }

  const normalizedIdentifier =
    normalizeSlug(identifier);

  const filters = [];

  if (
    mongoose.Types.ObjectId.isValid(
      identifier,
    )
  ) {
    filters.push({
      _id: identifier,
    });
  }

  if (normalizedIdentifier) {
    filters.push({
      slug: normalizedIdentifier,
    });
  }

  if (!filters.length) {
    return null;
  }

  const query = {
    $or: filters,
  };

  if (activeOnly) {
    query.isActive = true;
  }

  return CommerceManager.findOne(query);
};

async function rebuildCommerceManagerXml(
  doc,
) {
  const settings =
    getFeedSettings(doc);

  const selectedCodes =
    normalizeCodes(
      doc?.selectedProductCodes,
    );

  if (!doc?.isActive) {
    const xml = buildXml({
      title: settings.title,
      description:
        settings.description,
      itemsXml: "",
    });

    return setXmlCache(doc, xml, 0);
  }

  if (!selectedCodes.length) {
    const xml = buildXml({
      title: settings.title,
      description:
        settings.description,
      itemsXml: "",
    });

    return setXmlCache(doc, xml, 0);
  }

  const selectedSet =
    buildSelectedCodeSet(
      selectedCodes,
    );

  const allProducts =
    await Product.find(
      getProductQuery(settings),
    )
      .select(PRODUCT_SELECT)
      .sort({
        updatedAt: -1,
      })
      .lean();

  const products =
    allProducts.filter((product) =>
      getPossibleCodes(
        product,
      ).some((code) =>
        selectedSet.has(code),
      ),
    );

  const items = [];

  for (const product of products) {
    const productId = String(
      product?._id || "",
    ).trim();

    const title = String(
      product?.title || "",
    ).trim();

    const description =
      String(
        product?.shortDescription ||
        "",
      ).trim() ||
      String(
        product?.howToStyle || "",
      ).trim() ||
      title;

    const images = pickImages(
      product,
      settings,
    );

    const link = buildLink(product);

    const categories =
      safeArr(product?.categories)
        .map((category) =>
          typeof category ===
            "string"
            ? category.trim()
            : String(
              category?.name ||
              category?.title ||
              "",
            ).trim(),
        )
        .filter(Boolean);

    const productTypePath =
      categories.join(" > ");

    const googleProductCategory =
      getGoogleProductCategory(
        categories,
      );

    const customLabel0 =
      settings.customLabel0 ||
      categories[0] ||
      "";

    const customLabel1 =
      settings.customLabel1 ||
      doc?.slug ||
      "";

    const variants = safeArr(
      product?.variants,
    );

    const isVariable =
      product?.productType ===
      "variable" ||
      variants.length > 0;

    if (
      isVariable &&
      variants.length
    ) {
      for (const variant of variants) {
        const sku = String(
          variant?.sku || "",
        ).trim();

        const variantId = String(
          variant?._id || "",
        ).trim();

        const rawGtin = String(
          variant?.barcode || "",
        ).trim();

        const inventoryDetails =
          getInventoryDetails(
            variant,
            settings,
          );

        if (
          inventoryDetails.availability ===
          "out of stock" &&
          !settings.includeOutOfStock
        ) {
          continue;
        }

        items.push(
          buildItemXml({
            id:
              sku ||
              `${productId}-${variantId}`,

            itemGroupId:
              productId,

            title,

            desc: description,

            link,

            images,

            price:
              variant?.price ??
              product?.price,

            compareAtPrice:
              variant?.compareAtPrice ??
              product?.compareAtPrice,

            color:
              getProductColor(
                product,
                variant,
              ),

            size:
              getAttr(
                variant?.attributes,
                "size",
              ) || "NA",

            gtin: looksLikeGTIN(
              rawGtin,
            )
              ? rawGtin
              : "",

            mpn:
              sku ||
              product?.productCode ||
              product?.code ||
              "",

            productTypePath,

            googleProductCategory,

            customLabel0,

            customLabel1,

            availability:
              inventoryDetails.availability,

            inventory:
              inventoryDetails.inventory,
          }),
        );
      }
    } else {
      const inventoryDetails =
        getInventoryDetails(
          product,
          settings,
        );

      if (
        inventoryDetails.availability ===
        "out of stock" &&
        !settings.includeOutOfStock
      ) {
        continue;
      }

      items.push(
        buildItemXml({
          id:
            product?.sku ||
            product?.productCode ||
            product?.code ||
            productId,

          itemGroupId: "",

          title,

          desc: description,

          link,

          images,

          price: product?.price,

          compareAtPrice:
            product?.compareAtPrice,

          color:
            getProductColor(product),

          size: "NA",

          gtin: "",

          mpn:
            product?.sku ||
            product?.productCode ||
            product?.code ||
            "",

          productTypePath,

          googleProductCategory,

          customLabel0,

          customLabel1,

          availability:
            inventoryDetails.availability,

          inventory:
            inventoryDetails.inventory,
        }),
      );
    }
  }

  const xml = buildXml({
    title: settings.title,

    description:
      settings.description,

    itemsXml: items.join("\n"),
  });

  return setXmlCache(
    doc,
    xml,
    items.length,
  );
}

async function getCommerceManagerXml(
  doc,
  force = false,
) {
  if (!force) {
    const cached =
      getCachedXml(doc);

    if (cached) {
      return cached;
    }
  }

  return rebuildCommerceManagerXml(
    doc,
  );
}

const validateFeedPayload = ({
  name,
  selectedProductCodes,
  isActive,
  isDefault,
  feedSettings,
}) => {
  if (
    name !== undefined &&
    !String(name || "").trim()
  ) {
    return "name cannot be empty";
  }

  if (
    selectedProductCodes !==
    undefined &&
    !Array.isArray(
      selectedProductCodes,
    )
  ) {
    return "selectedProductCodes must be an array";
  }

  if (
    isActive !== undefined &&
    typeof isActive !== "boolean"
  ) {
    return "isActive must be true or false";
  }

  if (
    isDefault !== undefined &&
    typeof isDefault !== "boolean"
  ) {
    return "isDefault must be true or false";
  }

  if (
    feedSettings !== undefined &&
    (!feedSettings ||
      typeof feedSettings !==
      "object" ||
      Array.isArray(feedSettings))
  ) {
    return "feedSettings must be an object";
  }

  return "";
};

const applyFeedSettings = (
  doc,
  incomingSettings,
) => {
  if (
    incomingSettings === undefined
  ) {
    return;
  }

  const currentSettings =
    safeObject(
      typeof doc.feedSettings
        ?.toObject === "function"
        ? doc.feedSettings.toObject()
        : doc.feedSettings,
    );

  doc.feedSettings = {
    ...currentSettings,
    ...safeObject(incomingSettings),
  };
};

const setAsDefault = async (doc) => {
  await CommerceManager.updateMany(
    {
      _id: {
        $ne: doc._id,
      },
      isDefault: true,
    },
    {
      $set: {
        isDefault: false,
        lastUpdatedAt:
          new Date(),
      },
    },
  );

  doc.isDefault = true;
};

const handleDuplicateError = (
  error,
  res,
) => {
  if (error?.code !== 11000) {
    return false;
  }

  const key =
    Object.keys(
      error?.keyPattern || {},
    )[0] || "field";

  res.status(409).json({
    success: false,
    message: `A commerce feed with this ${key} already exists`,
  });

  return true;
};

/* -------------------------------------------------------------------------- */
/*                            DEFAULT FEED API                                */
/* -------------------------------------------------------------------------- */

export const getCommerceManagerConfig =
  async (req, res) => {
    try {
      const doc =
        await CommerceManager.getSingleton();

      return res
        .status(200)
        .json({
          success: true,
          data: toSafeResponse(
            doc,
            req,
          ),
        });
    } catch (error) {
      console.error(
        "getCommerceManagerConfig error:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to load commerce manager config",
        });
    }
  };

export const upsertCommerceManagerConfig =
  async (req, res) => {
    try {
      const {
        selectedProductCodes,
        isActive,
        notes,
        lastUpdatedBy,
        feedSettings,
      } = req.body || {};

      const validationError =
        validateFeedPayload({
          selectedProductCodes,
          isActive,
          feedSettings,
        });

      if (validationError) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              validationError,
          });
      }

      const doc =
        await CommerceManager.getSingleton();

      if (
        selectedProductCodes !==
        undefined
      ) {
        doc.selectedProductCodes =
          normalizeCodes(
            selectedProductCodes,
          );
      }

      if (
        typeof isActive ===
        "boolean"
      ) {
        doc.isActive = isActive;
      }

      if (notes !== undefined) {
        doc.notes = String(
          notes ?? "",
        ).trim();
      }

      applyFeedSettings(
        doc,
        feedSettings,
      );

      doc.touch(lastUpdatedBy);

      await doc.save();

      invalidateXmlCache(doc);

      return res
        .status(200)
        .json({
          success: true,
          message:
            "Default commerce manager feed updated successfully",
          data: toSafeResponse(
            doc,
            req,
          ),
        });
    } catch (error) {
      console.error(
        "upsertCommerceManagerConfig error:",
        error,
      );

      if (
        handleDuplicateError(
          error,
          res,
        )
      ) {
        return;
      }

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to update commerce manager config",
        });
    }
  };

export const addCommerceManagerProductCodes =
  async (req, res) => {
    try {
      const {
        productCodes = [],
        lastUpdatedBy = "",
      } = req.body || {};

      const incomingCodes =
        normalizeCodes(
          productCodes,
        );

      if (!incomingCodes.length) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "productCodes are required",
          });
      }

      const doc =
        await CommerceManager.getSingleton();

      if (
        typeof doc.addProductCodes ===
        "function"
      ) {
        doc.addProductCodes(
          incomingCodes,
        );
      } else {
        doc.selectedProductCodes =
          normalizeCodes([
            ...(doc.selectedProductCodes ||
              []),
            ...incomingCodes,
          ]);
      }

      doc.touch(lastUpdatedBy);

      await doc.save();

      invalidateXmlCache(doc);

      return res
        .status(200)
        .json({
          success: true,
          message:
            "Product codes added successfully",
          data: toSafeResponse(
            doc,
            req,
          ),
        });
    } catch (error) {
      console.error(
        "addCommerceManagerProductCodes error:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to add product codes",
        });
    }
  };

export const removeCommerceManagerProductCodes =
  async (req, res) => {
    try {
      const {
        productCodes = [],
        lastUpdatedBy = "",
      } = req.body || {};

      const normalizedCodesToRemove =
        normalizeCodes(productCodes);

      if (
        !normalizedCodesToRemove.length
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "productCodes are required",
          });
      }

      const doc =
        await CommerceManager.getSingleton();

      if (
        typeof doc.removeProductCodes ===
        "function"
      ) {
        doc.removeProductCodes(
          normalizedCodesToRemove,
        );
      } else {
        const removeSet = new Set(
          normalizedCodesToRemove,
        );

        doc.selectedProductCodes = (
          doc.selectedProductCodes ||
          []
        ).filter(
          (code) =>
            !removeSet.has(
              normalizeCode(code),
            ),
        );
      }

      doc.touch(lastUpdatedBy);

      await doc.save();

      invalidateXmlCache(doc);

      return res
        .status(200)
        .json({
          success: true,
          message:
            "Product codes removed successfully",
          data: toSafeResponse(
            doc,
            req,
          ),
        });
    } catch (error) {
      console.error(
        "removeCommerceManagerProductCodes error:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to remove product codes",
        });
    }
  };

export const clearCommerceManagerProductCodes =
  async (req, res) => {
    try {
      const {
        lastUpdatedBy = "",
      } = req.body || {};

      const doc =
        await CommerceManager.getSingleton();

      doc.selectedProductCodes = [];

      doc.touch(lastUpdatedBy);

      await doc.save();

      invalidateXmlCache(doc);

      return res
        .status(200)
        .json({
          success: true,
          message:
            "All product codes cleared successfully",
          data: toSafeResponse(
            doc,
            req,
          ),
        });
    } catch (error) {
      console.error(
        "clearCommerceManagerProductCodes error:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to clear product codes",
        });
    }
  };

export const toggleCommerceManagerStatus =
  async (req, res) => {
    try {
      const {
        isActive,
        lastUpdatedBy = "",
      } = req.body || {};

      if (
        typeof isActive !==
        "boolean"
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "isActive must be true or false",
          });
      }

      const doc =
        await CommerceManager.getSingleton();

      doc.isActive = isActive;

      doc.touch(lastUpdatedBy);

      await doc.save();

      invalidateXmlCache(doc);

      return res
        .status(200)
        .json({
          success: true,
          message: `Default commerce manager feed ${isActive
              ? "activated"
              : "deactivated"
            } successfully`,
          data: toSafeResponse(
            doc,
            req,
          ),
        });
    } catch (error) {
      console.error(
        "toggleCommerceManagerStatus error:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to toggle commerce manager status",
        });
    }
  };

/* -------------------------------------------------------------------------- */
/*                            MULTIPLE FEED CRUD                              */
/* -------------------------------------------------------------------------- */

export const listCommerceManagerFeeds =
  async (req, res) => {
    try {
      const {
        search = "",
        isActive,
        page = 1,
        limit = 50,
      } = req.query || {};

      const normalizedPage =
        Math.max(
          1,
          Number(page) || 1,
        );

      const normalizedLimit =
        Math.min(
          200,
          Math.max(
            1,
            Number(limit) || 50,
          ),
        );

      const filter = {};

      if (
        String(search || "").trim()
      ) {
        const escapedSearch =
          String(search)
            .trim()
            .replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            );

        const regex = new RegExp(
          escapedSearch,
          "i",
        );

        filter.$or = [
          {
            name: regex,
          },
          {
            slug: regex,
          },
          {
            selectedProductCodes:
              regex,
          },
        ];
      }

      if (
        isActive === "true" ||
        isActive === true
      ) {
        filter.isActive = true;
      }

      if (
        isActive === "false" ||
        isActive === false
      ) {
        filter.isActive = false;
      }

      const [docs, total] =
        await Promise.all([
          CommerceManager.find(
            filter,
          )
            .sort({
              isDefault: -1,
              updatedAt: -1,
            })
            .skip(
              (normalizedPage - 1) *
              normalizedLimit,
            )
            .limit(
              normalizedLimit,
            )
            .lean(),

          CommerceManager.countDocuments(
            filter,
          ),
        ]);

      return res
        .status(200)
        .json({
          success: true,

          data: docs.map((doc) =>
            toSafeResponse(
              doc,
              req,
            ),
          ),

          pagination: {
            page:
              normalizedPage,

            limit:
              normalizedLimit,

            total,

            pages: Math.max(
              1,
              Math.ceil(
                total /
                normalizedLimit,
              ),
            ),
          },
        });
    } catch (error) {
      console.error(
        "listCommerceManagerFeeds error:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to load commerce manager feeds",
        });
    }
  };

export const getCommerceManagerFeed =
  async (req, res) => {
    try {
      const identifier =
        req.params.id ||
        req.params.slug ||
        "default";

      const doc =
        await findFeedByIdentifier(
          identifier,
        );

      if (!doc) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Commerce manager feed not found",
          });
      }

      return res
        .status(200)
        .json({
          success: true,
          data: toSafeResponse(
            doc,
            req,
          ),
        });
    } catch (error) {
      console.error(
        "getCommerceManagerFeed error:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to load commerce manager feed",
        });
    }
  };

export const createCommerceManagerFeed =
  async (req, res) => {
    try {
      const {
        name,
        slug,
        selectedProductCodes = [],
        isActive = true,
        isDefault = false,
        notes = "",
        feedSettings = {},
        lastUpdatedBy = "",
      } = req.body || {};

      const validationError =
        validateFeedPayload({
          name,
          selectedProductCodes,
          isActive,
          isDefault,
          feedSettings,
        });

      if (validationError) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              validationError,
          });
      }

      if (
        !String(name || "").trim()
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "name is required",
          });
      }

      const generatedSlug =
        typeof CommerceManager.generateUniqueSlug ===
          "function"
          ? await CommerceManager.generateUniqueSlug(
            slug || name,
          )
          : normalizeSlug(
            slug || name,
          );

      const doc =
        new CommerceManager({
          name: String(
            name,
          ).trim(),

          slug:
            generatedSlug,

          selectedProductCodes:
            normalizeCodes(
              selectedProductCodes,
            ),

          isActive,

          isDefault: false,

          notes: String(
            notes || "",
          ).trim(),

          feedSettings:
            safeObject(
              feedSettings,
            ),

          lastUpdatedAt:
            new Date(),

          lastUpdatedBy:
            String(
              lastUpdatedBy || "",
            ).trim(),
        });

      if (isDefault) {
        await setAsDefault(doc);
      }

      await doc.save();

      invalidateXmlCache();

      return res
        .status(201)
        .json({
          success: true,
          message:
            "Commerce manager feed created successfully",
          data: toSafeResponse(
            doc,
            req,
          ),
        });
    } catch (error) {
      console.error(
        "createCommerceManagerFeed error:",
        error,
      );

      if (
        handleDuplicateError(
          error,
          res,
        )
      ) {
        return;
      }

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to create commerce manager feed",
        });
    }
  };

export const updateCommerceManagerFeed =
  async (req, res) => {
    try {
      const identifier =
        req.params.id ||
        req.params.slug ||
        "";

      const doc =
        await findFeedByIdentifier(
          identifier,
        );

      if (!doc) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Commerce manager feed not found",
          });
      }

      const {
        name,
        slug,
        selectedProductCodes,
        isActive,
        isDefault,
        notes,
        feedSettings,
        lastUpdatedBy = "",
      } = req.body || {};

      const validationError =
        validateFeedPayload({
          name,
          selectedProductCodes,
          isActive,
          isDefault,
          feedSettings,
        });

      if (validationError) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              validationError,
          });
      }

      const previousSlug =
        doc.slug;

      if (name !== undefined) {
        doc.name = String(
          name,
        ).trim();
      }

      if (slug !== undefined) {
        doc.slug =
          typeof CommerceManager.generateUniqueSlug ===
            "function"
            ? await CommerceManager.generateUniqueSlug(
              slug,
              doc._id,
            )
            : normalizeSlug(slug);
      }

      if (
        selectedProductCodes !==
        undefined
      ) {
        doc.selectedProductCodes =
          normalizeCodes(
            selectedProductCodes,
          );
      }

      if (
        typeof isActive ===
        "boolean"
      ) {
        doc.isActive =
          isActive;
      }

      if (notes !== undefined) {
        doc.notes = String(
          notes || "",
        ).trim();
      }

      applyFeedSettings(
        doc,
        feedSettings,
      );

      if (isDefault === true) {
        await setAsDefault(doc);
      }

      if (
        isDefault === false &&
        doc.isDefault
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Assign another feed as default before removing this default feed",
          });
      }

      doc.touch(lastUpdatedBy);

      await doc.save();

      invalidateXmlCache(doc);
      invalidateXmlCache(
        previousSlug,
      );

      return res
        .status(200)
        .json({
          success: true,
          message:
            "Commerce manager feed updated successfully",
          data: toSafeResponse(
            doc,
            req,
          ),
        });
    } catch (error) {
      console.error(
        "updateCommerceManagerFeed error:",
        error,
      );

      if (
        handleDuplicateError(
          error,
          res,
        )
      ) {
        return;
      }

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to update commerce manager feed",
        });
    }
  };

export const deleteCommerceManagerFeed =
  async (req, res) => {
    try {
      const identifier =
        req.params.id ||
        req.params.slug ||
        "";

      const doc =
        await findFeedByIdentifier(
          identifier,
        );

      if (!doc) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Commerce manager feed not found",
          });
      }

      if (doc.isDefault) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Default commerce feed cannot be deleted",
          });
      }

      await doc.deleteOne();

      invalidateXmlCache(doc);

      return res
        .status(200)
        .json({
          success: true,
          message:
            "Commerce manager feed deleted successfully",
        });
    } catch (error) {
      console.error(
        "deleteCommerceManagerFeed error:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to delete commerce manager feed",
        });
    }
  };

export const addFeedProductCodes =
  async (req, res) => {
    try {
      const identifier =
        req.params.id ||
        req.params.slug ||
        "";

      const {
        productCodes = [],
        lastUpdatedBy = "",
      } = req.body || {};

      const incomingCodes =
        normalizeCodes(
          productCodes,
        );

      if (!incomingCodes.length) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "productCodes are required",
          });
      }

      const doc =
        await findFeedByIdentifier(
          identifier,
        );

      if (!doc) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Commerce manager feed not found",
          });
      }

      if (
        typeof doc.addProductCodes ===
        "function"
      ) {
        doc.addProductCodes(
          incomingCodes,
        );
      } else {
        doc.selectedProductCodes =
          normalizeCodes([
            ...(doc.selectedProductCodes ||
              []),
            ...incomingCodes,
          ]);
      }

      doc.touch(lastUpdatedBy);

      await doc.save();

      invalidateXmlCache(doc);

      return res
        .status(200)
        .json({
          success: true,
          message:
            "Product codes added successfully",
          data: toSafeResponse(
            doc,
            req,
          ),
        });
    } catch (error) {
      console.error(
        "addFeedProductCodes error:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to add product codes",
        });
    }
  };

export const removeFeedProductCodes =
  async (req, res) => {
    try {
      const identifier =
        req.params.id ||
        req.params.slug ||
        "";

      const {
        productCodes = [],
        lastUpdatedBy = "",
      } = req.body || {};

      const codesToRemove =
        normalizeCodes(
          productCodes,
        );

      if (!codesToRemove.length) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "productCodes are required",
          });
      }

      const doc =
        await findFeedByIdentifier(
          identifier,
        );

      if (!doc) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Commerce manager feed not found",
          });
      }

      if (
        typeof doc.removeProductCodes ===
        "function"
      ) {
        doc.removeProductCodes(
          codesToRemove,
        );
      } else {
        const removeSet =
          new Set(
            codesToRemove,
          );

        doc.selectedProductCodes = (
          doc.selectedProductCodes ||
          []
        ).filter(
          (code) =>
            !removeSet.has(
              normalizeCode(code),
            ),
        );
      }

      doc.touch(lastUpdatedBy);

      await doc.save();

      invalidateXmlCache(doc);

      return res
        .status(200)
        .json({
          success: true,
          message:
            "Product codes removed successfully",
          data: toSafeResponse(
            doc,
            req,
          ),
        });
    } catch (error) {
      console.error(
        "removeFeedProductCodes error:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to remove product codes",
        });
    }
  };

export const clearFeedProductCodes =
  async (req, res) => {
    try {
      const identifier =
        req.params.id ||
        req.params.slug ||
        "";

      const {
        lastUpdatedBy = "",
      } = req.body || {};

      const doc =
        await findFeedByIdentifier(
          identifier,
        );

      if (!doc) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Commerce manager feed not found",
          });
      }

      doc.selectedProductCodes = [];

      doc.touch(lastUpdatedBy);

      await doc.save();

      invalidateXmlCache(doc);

      return res
        .status(200)
        .json({
          success: true,
          message:
            "All product codes cleared successfully",
          data: toSafeResponse(
            doc,
            req,
          ),
        });
    } catch (error) {
      console.error(
        "clearFeedProductCodes error:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to clear product codes",
        });
    }
  };

/* -------------------------------------------------------------------------- */
/*                                 XML FEEDS                                  */
/* -------------------------------------------------------------------------- */

const sendXmlFeed = async ({
  req,
  res,
  doc,
  force = false,
}) => {
  const feed =
    await getCommerceManagerXml(
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
    "X-Commerce-Feed-Slug",
    doc?.slug || "default",
  );

  res.setHeader(
    "X-Commerce-Feed-Items",
    String(feed.meta.count),
  );

  return res
    .status(200)
    .send(feed.xml);
};

export const getCommerceManagerXmlFeed =
  async (req, res) => {
    try {
      const doc =
        await CommerceManager.getSingleton();

      if (!doc?.isActive) {
        return res
          .status(404)
          .type("application/xml")
          .send(
            buildXml({
              title:
                "Oatclub Commerce Manager Feed",

              description:
                "This commerce manager feed is currently inactive.",

              itemsXml: "",
            }),
          );
      }

      return sendXmlFeed({
        req,
        res,
        doc,
        force: false,
      });
    } catch (error) {
      console.error(
        "getCommerceManagerXmlFeed error:",
        error,
      );

      return res
        .status(500)
        .type("application/xml")
        .send(
          '<?xml version="1.0" encoding="UTF-8"?><error><message>Commerce manager XML generation failed</message></error>',
        );
    }
  };

export const getCommerceManagerXmlFeedBySlug =
  async (req, res) => {
    try {
      const slug =
        normalizeSlug(
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
        await findFeedByIdentifier(
          slug,
          {
            activeOnly: true,
          },
        );

      if (!doc) {
        return res
          .status(404)
          .type("application/xml")
          .send(
            '<?xml version="1.0" encoding="UTF-8"?><error><message>Commerce manager feed not found or inactive</message></error>',
          );
      }

      return sendXmlFeed({
        req,
        res,
        doc,
        force: false,
      });
    } catch (error) {
      console.error(
        "getCommerceManagerXmlFeedBySlug error:",
        error,
      );

      return res
        .status(500)
        .type("application/xml")
        .send(
          '<?xml version="1.0" encoding="UTF-8"?><error><message>Commerce manager XML generation failed</message></error>',
        );
    }
  };

export const refreshCommerceManagerXmlFeed =
  async (req, res) => {
    try {
      const identifier =
        req.params.id ||
        req.params.slug ||
        "default";

      const doc =
        await findFeedByIdentifier(
          identifier,
        );

      if (!doc) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Commerce manager feed not found",
          });
      }

      const feed =
        await getCommerceManagerXml(
          doc,
          true,
        );

      return res
        .status(200)
        .json({
          success: true,

          feed: toSafeResponse(
            doc,
            req,
          ),

          count:
            feed.meta.count,

          builtAt:
            feed.meta.builtAt,
        });
    } catch (error) {
      console.error(
        "refreshCommerceManagerXmlFeed error:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to refresh commerce manager XML",
        });
    }
  };

export const getCommerceManagerXmlFeedStatus =
  async (req, res) => {
    try {
      const identifier =
        req.params.id ||
        req.params.slug ||
        "default";

      const doc =
        await findFeedByIdentifier(
          identifier,
        );

      if (!doc) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Commerce manager feed not found",
          });
      }

      const cache =
        xmlCache.get(
          getCacheKey(doc),
        ) ||
        xmlCache.get(
          normalizeSlug(
            doc.slug,
          ),
        ) ||
        null;

      return res
        .status(200)
        .json({
          success: true,

          feed: toSafeResponse(
            doc,
            req,
          ),

          count:
            cache?.meta?.count ||
            0,

          builtAt:
            cache?.meta
              ?.builtAt || null,

          cached: Boolean(
            cache?.xml &&
            cache.expiresAt >
            Date.now(),
          ),

          expiresAt:
            cache?.expiresAt ||
            0,
        });
    } catch (error) {
      console.error(
        "getCommerceManagerXmlFeedStatus error:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to load commerce manager feed status",
        });
    }
  };

export const clearCommerceManagerXmlCache =
  async (req, res) => {
    try {
      const identifier =
        req.params.id ||
        req.params.slug ||
        "";

      if (identifier) {
        const doc =
          await findFeedByIdentifier(
            identifier,
          );

        if (!doc) {
          return res
            .status(404)
            .json({
              success: false,
              message:
                "Commerce manager feed not found",
            });
        }

        invalidateXmlCache(doc);

        return res
          .status(200)
          .json({
            success: true,
            message: `Cache cleared for ${doc.name}`,
          });
      }

      invalidateXmlCache();

      return res
        .status(200)
        .json({
          success: true,
          message:
            "All commerce manager XML caches cleared",
        });
    } catch (error) {
      console.error(
        "clearCommerceManagerXmlCache error:",
        error,
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to clear commerce manager XML cache",
        });
    }
  };
