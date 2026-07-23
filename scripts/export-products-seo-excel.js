import "dotenv/config";
import mongoose from "mongoose";
import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORE_URL = String(
  process.env.STORE_URL || "https://www.oatclub.in",
).replace(/\/+$/, "");

const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.DATABASE_URL ||
  "";

const OUTPUT_DIR = path.resolve(__dirname, "../exports");

const OUTPUT_FILE = path.join(
  OUTPUT_DIR,
  `oatclub-product-seo-${new Date().toISOString().slice(0, 10)}.xlsx`,
);

const safeText = (value = "") => String(value ?? "").trim();

const joinValues = (values = [], separator = ", ") =>
  Array.isArray(values)
    ? values.map(safeText).filter(Boolean).join(separator)
    : "";

const joinObjects = (items = [], formatter) =>
  Array.isArray(items)
    ? items.map(formatter).map(safeText).filter(Boolean).join(" | ")
    : "";

const slugify = (value = "") =>
  safeText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeCategory = (categories = []) => {
  const primaryCategory = Array.isArray(categories)
    ? categories.find((category) => safeText(category))
    : "";

  return slugify(primaryCategory || "products") || "products";
};

const buildProductLink = (product = {}) => {
  const category = normalizeCategory(product.categories);
  const productSlug = slugify(product.slug || product.title);
  const productCode = safeText(product.productCode);

  return `${STORE_URL}/category/${encodeURIComponent(
    category,
  )}/${encodeURIComponent(productSlug)}/${encodeURIComponent(productCode)}`;
};

const flattenSpecifications = (specifications = []) =>
  joinObjects(
    specifications,
    (item) => `${safeText(item?.key)}: ${safeText(item?.value)}`,
  );

const flattenFabrics = (fabrics = []) =>
  joinObjects(fabrics, (item) => {
    const details = [
      safeText(item?.fabricName),
      safeText(item?.fabricCode) &&
        `Code: ${safeText(item.fabricCode)}`,
      safeText(item?.fabricColor) &&
        `Color: ${safeText(item.fabricColor)}`,
      safeText(item?.role) &&
        `Role: ${safeText(item.role)}`,
    ].filter(Boolean);

    return details.join(" / ");
  });

const flattenVariants = (variants = []) =>
  joinObjects(variants, (variant) => {
    const attributes = joinObjects(
      variant?.attributes,
      (attribute) =>
        `${safeText(attribute?.key)}: ${safeText(attribute?.value)}`,
    );

    return [
      safeText(variant?.sku) &&
        `SKU: ${safeText(variant.sku)}`,
      safeText(variant?.barcode) &&
        `Barcode: ${safeText(variant.barcode)}`,
      safeText(variant?.patternNumber) &&
        `Pattern: ${safeText(variant.patternNumber)}`,
      attributes,
      `Stock: ${Number(variant?.stock || 0)}`,
      `Reserved: ${Number(variant?.reservedStock || 0)}`,
      `In stock: ${variant?.isInStock ? "Yes" : "No"}`,
    ]
      .filter(Boolean)
      .join(" / ");
  });

/*
  Empty schema use kar rahe hain so script ko Product model
  import path ke baare mein tension nahi hogi.
*/
const productSchema = new mongoose.Schema(
  {},
  {
    strict: false,
    collection: process.env.PRODUCT_COLLECTION || "products",
  },
);

const Product =
  mongoose.models.ProductExcelExport ||
  mongoose.model("ProductExcelExport", productSchema);

const createRows = (products = []) =>
  products.map((product, index) => ({
    "S.No.": index + 1,

    "Product Code": safeText(product.productCode),
    "Product Name": safeText(product.title),
    Slug: safeText(product.slug),

    Categories: joinValues(product.categories),
    "Primary Category": normalizeCategory(product.categories),
    "Product Link": buildProductLink(product),

    "Meta Title": safeText(product.metaTitle),
    "Meta Description": safeText(product.metaDescription),
    "Meta Keywords": joinValues(product.keywords),

    "Short Description": safeText(product.shortDescription),
    "How To Style": safeText(product.howToStyle),
    "Key Features": joinValues(product.keyFeatures, " | "),
    "Fabric Details": safeText(product.fabricDetails),
    Specifications: flattenSpecifications(product.specifications),

    Tags: joinValues(product.tags),
    Colors: joinValues(product.colors),
    Fabrics: flattenFabrics(product.fabrics),

    Price: Number(product.price || 0),

    "Compare At Price":
      product.compareAtPrice === null ||
      product.compareAtPrice === undefined
        ? ""
        : Number(product.compareAtPrice),

    Currency: safeText(product.currency || "INR"),
    SKU: safeText(product.sku),
    "HSN Code": safeText(product.hsnCode),

    "Product Type": safeText(product.productType),

    Stock: Number(product.stock || 0),
    "Reserved Stock": Number(product.reservedStock || 0),
    "In Stock": product.isInStock ? "Yes" : "No",

    Variants: flattenVariants(product.variants),

    "Thumbnail URL": safeText(product.thumbnail),
    "Image URLs": joinValues(product.images, " | "),
    "Video URL": safeText(product.video),

    "Original Product Link": safeText(product.originalProductLink),

    "Average Rating": Number(product.averageRating || 0),
    "Total Reviews": Number(product.totalReviews || 0),

    "Is Active": product.isActive ? "Yes" : "No",
    "Is Draft": product.isDraft ? "Yes" : "No",
    "Is Featured": product.isFeatured ? "Yes" : "No",
    "Is Bestseller": product.isBestSeller ? "Yes" : "No",
    "Is Trending": product.isTrending ? "Yes" : "No",
    "Available For Collab": product.availableForCollab
      ? "Yes"
      : "No",

    "Created At": product.createdAt
      ? new Date(product.createdAt).toISOString()
      : "",

    "Updated At": product.updatedAt
      ? new Date(product.updatedAt).toISOString()
      : "",
  }));

const setColumnWidths = (worksheet, rows) => {
  if (!rows.length) return;

  const headers = Object.keys(rows[0]);

  const wideColumns = new Set([
    "Product Name",
    "Product Link",
    "Meta Title",
    "Meta Description",
    "Meta Keywords",
    "Short Description",
    "How To Style",
    "Key Features",
    "Fabric Details",
    "Specifications",
    "Fabrics",
    "Variants",
    "Image URLs",
    "Original Product Link",
  ]);

  worksheet["!cols"] = headers.map((header) => {
    const longestValue = rows.reduce((maxLength, row) => {
      const valueLength = safeText(row[header]).length;
      return Math.max(maxLength, valueLength);
    }, header.length);

    const maximumWidth = wideColumns.has(header) ? 55 : 28;

    return {
      wch: Math.min(
        Math.max(longestValue + 2, 12),
        maximumWidth,
      ),
    };
  });
};

const configureWorksheet = (
  worksheet,
  rowCount,
  columnCount,
) => {
  worksheet["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: {
        r: Math.max(rowCount, 1),
        c: Math.max(columnCount - 1, 0),
      },
    }),
  };

  worksheet["!freeze"] = {
    xSplit: 0,
    ySplit: 1,
  };

  worksheet["!rows"] = [
    {
      hpt: 28,
    },
  ];
};

const createSummaryRows = (products = []) => [
  {
    Metric: "Exported Products",
    Value: products.length,
  },
  {
    Metric: "Store URL",
    Value: STORE_URL,
  },
  {
    Metric: "Generated At",
    Value: new Date().toISOString(),
  },
  {
    Metric: "Products Missing Meta Title",
    Value: products.filter(
      (product) => !safeText(product.metaTitle),
    ).length,
  },
  {
    Metric: "Products Missing Meta Description",
    Value: products.filter(
      (product) => !safeText(product.metaDescription),
    ).length,
  },
  {
    Metric: "Products Missing Keywords",
    Value: products.filter(
      (product) =>
        !Array.isArray(product.keywords) ||
        product.keywords.filter(Boolean).length === 0,
    ).length,
  },
  {
    Metric: "Products Missing Category",
    Value: products.filter(
      (product) =>
        !Array.isArray(product.categories) ||
        product.categories.filter(Boolean).length === 0,
    ).length,
  },
  {
    Metric: "Products Missing Slug",
    Value: products.filter(
      (product) => !safeText(product.slug),
    ).length,
  },
];

async function exportProducts() {
  if (!MONGO_URI) {
    throw new Error(
      "MongoDB URI missing. Add MONGO_URI or MONGODB_URI in .env",
    );
  }

  console.log("Connecting to MongoDB...");

  await mongoose.connect(MONGO_URI);

  try {
    console.log("Fetching products...");

    const products = await Product.find({})
      .sort({
        productCode: 1,
      })
      .lean();

    if (!products.length) {
      console.log("No products found.");
      return;
    }

    const rows = createRows(products);

    const workbook = XLSX.utils.book_new();

    const productWorksheet =
      XLSX.utils.json_to_sheet(rows);

    setColumnWidths(productWorksheet, rows);

    configureWorksheet(
      productWorksheet,
      rows.length,
      Object.keys(rows[0]).length,
    );

    XLSX.utils.book_append_sheet(
      workbook,
      productWorksheet,
      "Product SEO Export",
    );

    const summaryRows = createSummaryRows(products);

    const summaryWorksheet =
      XLSX.utils.json_to_sheet(summaryRows);

    summaryWorksheet["!cols"] = [
      {
        wch: 40,
      },
      {
        wch: 65,
      },
    ];

    configureWorksheet(
      summaryWorksheet,
      summaryRows.length,
      2,
    );

    XLSX.utils.book_append_sheet(
      workbook,
      summaryWorksheet,
      "SEO Summary",
    );

    fs.mkdirSync(OUTPUT_DIR, {
      recursive: true,
    });

    XLSX.writeFile(workbook, OUTPUT_FILE, {
      compression: true,
    });

    console.log("");
    console.log("✅ Product Excel export completed");
    console.log(`✅ Total products: ${products.length}`);
    console.log(`✅ File generated at:`);
    console.log(OUTPUT_FILE);
  } finally {
    await mongoose.disconnect();
  }
}

exportProducts().catch((error) => {
  console.error("");
  console.error("❌ Product Excel export failed");
  console.error(error?.stack || error?.message || error);

  process.exitCode = 1;
});