import fs from "fs";
import csv from "csv-parser";
import slugify from "slugify";
import fse from "fs-extra";
import axios from "axios";

/* ============================================================
   CONFIG
============================================================ */
const INPUT_CSV = "./scripts/31stdec/wc-product-export-31-12-2025-1767162128026.csv";
const OUTPUT_JSON = "./scripts/31stdec/products.mapped.json";

// Optional: directly import to API
const IMPORT_TO_API = false;
const API_URL = "http://localhost:5000/api/products/bulk/import"; // change to your deployed API

/* ============================================================
   HELPERS
============================================================ */
const splitComma = (v) =>
  !v
    ? []
    : String(v)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

const splitHierarchyLeaf = (cat) => {
  // "Top > Crop Top" => "Crop Top"
  const parts = String(cat).split(">").map((x) => x.trim()).filter(Boolean);
  return parts[parts.length - 1] || "";
};

const toSlug = (s) =>
  slugify(String(s || ""), { lower: true, strict: true });

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const yesNo = (v) => {
  if (v === 1 || v === "1") return true;
  const s = String(v || "").toLowerCase();
  return s.includes("yes") || s.includes("true");
};

const parseImages = (v) => splitComma(v);

/* ============================================================
   MAIN MAPPER
============================================================ */
async function run() {
  const products = [];
  const failed = [];

  let currentVariable = null;

  await new Promise((resolve, reject) => {
    fs.createReadStream(INPUT_CSV)
      .pipe(csv())
      .on("data", (row) => {
        try {
          const type = String(row["Type"] || "").trim().toLowerCase();

          /* ================================================
             VARIABLE PRODUCT (PARENT)
          ================================================ */
          if (type === "variable" || type === "simple") {
            // push previous variable if exists
            if (currentVariable) products.push(currentVariable);

            const wpId = row["ID"] ? Number(row["ID"]) : null;
            const title = row["Name"] || "";
            const slug = toSlug(row["Name"] || row["SKU"] || wpId);

            const categories = splitComma(row["Categories"]).map(splitHierarchyLeaf);
            const categorySlugs = categories.map(toSlug);

            const tags = splitComma(row["Tags"]).map((t) => t.toLowerCase());

            const images = parseImages(row["Images"]);
            const thumbnail = images[0] || "";

            const regularPrice = num(row["Regular price"], 0);
            const salePrice = num(row["Sale price"], 0);
            const price = salePrice > 0 ? salePrice : regularPrice;

            const stock = num(row["Stock"], 0);

            currentVariable = {
              wordpressId: wpId,
              title,
              slug,

              description: row["Description"] || "",
              shortDescription: row["Short description"] || "",

              categories: categorySlugs,
              tags,

              price,
              compareAtPrice: regularPrice > price ? regularPrice : null,

              stock,
              isInStock: yesNo(row["In stock?"]) || stock > 0,

              images,
              thumbnail,

              attributes: [], // optional: fill later
              variants: [],

              isDraft: false,
              isActive: true,
            };

            return;
          }

          /* ================================================
             VARIATION (CHILD)
          ================================================ */
          if (type === "variation") {
            if (!currentVariable) {
              failed.push({ row, reason: "Variation found before any variable product" });
              return;
            }

            const varPrice = num(row["Regular price"], 0) || num(row["Sale price"], 0);
            const varStock = num(row["Stock"], 0);

            // Extract attribute 1 + attribute 2 if present
            const vAttrs = [];

            for (let i = 1; i <= 5; i++) {
              const key = row[`Attribute ${i} name`];
              const value = row[`Attribute ${i} value(s)`];
              if (key && value) {
                vAttrs.push({ key: String(key).trim(), value: String(value).trim() });
              }
            }

            const variant = {
              attributes: vAttrs,
              sku: row["SKU"] || undefined,
              barcode: row["GTIN, UPC, EAN, or ISBN"] || "",
              price: varPrice,
              compareAtPrice: null,
              stock: varStock,
              isInStock: yesNo(row["In stock?"]) || varStock > 0,
              weight: num(row["Weight (kg)"], 0),
            };

            currentVariable.variants.push(variant);

            return;
          }
        } catch (e) {
          failed.push({ row, reason: e.message });
        }
      })
      .on("end", resolve)
      .on("error", reject);
  });

  // push last variable
  if (currentVariable) products.push(currentVariable);

  console.log("✅ Total mapped products:", products.length);
  console.log("⚠️ Failed rows:", failed.length);

  await fse.writeJSON(OUTPUT_JSON, { products }, { spaces: 2 });

  console.log("📦 Saved:", OUTPUT_JSON);

  /* ============================================================
     OPTIONAL: Direct Import to API
  ============================================================ */
  if (IMPORT_TO_API) {
    console.log("🚀 Importing to API:", API_URL);

    const chunkSize = 50;
    for (let i = 0; i < products.length; i += chunkSize) {
      const chunk = products.slice(i, i + chunkSize);
      const res = await axios.post(API_URL, { products: chunk });
      console.log(
        `Batch ${i}-${i + chunk.length} imported:`,
        res.data.importedCount,
        "failed:",
        res.data.failedCount
      );
    }
  }

  console.log("🎉 Done.");
}

run().catch(console.error);
