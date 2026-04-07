// controllers/product.search.controller.js

import Product from "./Products.js";

/* =========================================================
   HELPERS
========================================================= */
const toPositiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeArrayQuery = (value) => {
  if (!value) return [];

  // supports:
  // ?tags=summer,party
  // ?tags=summer&tags=party
  if (Array.isArray(value)) {
    return value
      .flatMap((v) => String(v).split(","))
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }

  return String(value)
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
};

/* =========================================================
   SEARCH PRODUCTS FOR CARD
   Search by:
   - productCode
   - title
   - tags
   - category
   - color

   Returns only card-friendly fields for speed
========================================================= */
export const searchProductsForCard = async (req, res) => {
  try {
    const {
      q = "",
      productCode = "",
      title = "",
      tag = "",
      tags = "",
      category = "",
      color = "",
      page = 1,
      limit = 20,
      sortBy = "relevance", // relevance | latest | price_asc | price_desc
      activeOnly = "true",
      excludeDrafts = "true",
    } = req.query;

    const currentPage = toPositiveInt(page, 1);
    const perPage = Math.min(toPositiveInt(limit, 20), 100);
    const skip = (currentPage - 1) * perPage;

    const andFilters = [];

    /* -------------------------
       Basic visibility filters
    ------------------------- */
    if (String(activeOnly) === "true") {
      andFilters.push({ isActive: true });
    }

    if (String(excludeDrafts) === "true") {
      andFilters.push({ isDraft: { $ne: true } });
    }

    /* -------------------------
       Exact / focused filters
    ------------------------- */
    if (productCode.trim()) {
      andFilters.push({
        productCode: { $regex: `^${escapeRegex(productCode.trim())}`, $options: "i" },
      });
    }

    if (title.trim()) {
      andFilters.push({
        title: { $regex: escapeRegex(title.trim()), $options: "i" },
      });
    }

    const tagList = normalizeArrayQuery(tags || tag);
    if (tagList.length) {
      andFilters.push({ tags: { $in: tagList } });
    }

    const categoryList = normalizeArrayQuery(category);
    if (categoryList.length) {
      andFilters.push({ categories: { $in: categoryList } });
    }

    const colorList = normalizeArrayQuery(color);
    if (colorList.length) {
      andFilters.push({ colors: { $in: colorList } });
    }

    /* -------------------------
       Global search query
       q searches:
       - productCode
       - title
       - tags
       - categories
       - colors
    ------------------------- */
    const trimmedQ = String(q).trim();
    if (trimmedQ) {
      const safeQ = escapeRegex(trimmedQ.toLowerCase());

      andFilters.push({
        $or: [
          { productCode: { $regex: safeQ, $options: "i" } },
          { title: { $regex: safeQ, $options: "i" } },
          { tags: { $elemMatch: { $regex: safeQ, $options: "i" } } },
          { categories: { $elemMatch: { $regex: safeQ, $options: "i" } } },
          { colors: { $elemMatch: { $regex: safeQ, $options: "i" } } },
        ],
      });
    }

    const query = andFilters.length ? { $and: andFilters } : {};

    /* -------------------------
       Sorting
    ------------------------- */
    let sort = { createdAt: -1 };

    if (sortBy === "price_asc") sort = { price: 1, createdAt: -1 };
    if (sortBy === "price_desc") sort = { price: -1, createdAt: -1 };
    if (sortBy === "latest") sort = { createdAt: -1 };
    if (sortBy === "relevance") {
      // good default for cards
      sort = {
        isBestSeller: -1,
        isTrending: -1,
        createdAt: -1,
      };
    }

    /* -------------------------
       Card-only projection
    ------------------------- */
    const projection = {
      _id: 1,
      productCode: 1,
      title: 1,
      slug: 1,
      categories: 1,
      thumbnail: 1,
      images: { $slice: 2 }, // only first 2 images needed for card + hover
      price: 1,
      compareAtPrice: 1,
      variants: 1, // safe fallback for card pricing logic
      isBestSeller: 1,
      isTrending: 1,
      colors: 1,
      tags: 1,
      isActive: 1,
      createdAt: 1,
    };

    const [products, total] = await Promise.all([
      Product.find(query)
        .select(projection)
        .sort(sort)
        .skip(skip)
        .limit(perPage)
        .lean(),
      Product.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      message: "Products fetched successfully",
      pagination: {
        page: currentPage,
        limit: perPage,
        total,
        pages: Math.ceil(total / perPage),
        hasNextPage: skip + products.length < total,
        hasPrevPage: currentPage > 1,
      },
      filters: {
        q: trimmedQ || "",
        productCode: productCode || "",
        title: title || "",
        tags: tagList,
        categories: categoryList,
        colors: colorList,
        sortBy,
      },
      products,
    });
  } catch (error) {
    console.error("searchProductsForCard error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to search products",
      error: error.message,
    });
  }
};