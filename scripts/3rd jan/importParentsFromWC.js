import mongoose from "mongoose";
import csv from "csvtojson";
import slugify from "slugify";

import Product from "../../Products/Products.js";
import { generateVariants } from "../../utility/variants.js"; // ✅ same as controller

const MONGO_URI = process.env.MONGO_URI;

// ✅ helpers
const arr = (v) =>
  !v
    ? []
    : Array.isArray(v)
    ? v
    : String(v)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

const tagsNorm = (v) =>
  arr(v).map((t) => String(t).trim().toLowerCase()).filter(Boolean);

const parseImages = (val) => {
  if (!val) return [];
  return String(val)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
};

// ✅ Woo CSV Attribute parser
const parseWCAttributes = (row) => {
  const attrs = [];

  for (let i = 1; i <= 6; i++) {
    const name = row[`Attribute ${i} name`];
    const values = row[`Attribute ${i} value(s)`];

    if (!name || !values) continue;

    const key = String(name).trim().toLowerCase();
    const vals = String(values)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (!key || !vals.length) continue;

    attrs.push({
      key,
      values: vals,
    });
  }

  return attrs;
};

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected MongoDB");

const filePath = "scripts/3rd jan/wc-product-export-3-1-2026-1767450524719.csv";
  const rows = await csv().fromFile(filePath);

  // ✅ Parents only (ignore "variation")
  const parents = rows.filter((r) => String(r.Type || "").toLowerCase() !== "variation");

  console.log("📦 Total Rows:", rows.length);
  console.log("✅ Parent Rows:", parents.length);

  let created = 0;
  let skipped = 0;

  for (let i = 0; i < parents.length; i++) {
    const r = parents[i];

    try {
      const title = String(r.Name || "").trim();
      if (!title) {
        skipped++;
        continue;
      }

      const slug = slugify(title, { lower: true, strict: true });

      // ✅ Skip if already exists
      const exists = await Product.exists({ slug });
      if (exists) {
        skipped++;
        continue;
      }

      const price = Number(r["Regular price"] || 0);
      const compareAtPrice = r["Sale price"] ? Number(r["Sale price"]) : null;

      const categories = arr(r.Categories);
      const tags = tagsNorm(r.Tags);

      const images = parseImages(r.Images);
      const thumbnail = images[0] || "";

      const attributes = parseWCAttributes(r);

      // ✅ auto-generate variants using your existing utility
      const variants = generateVariants({
        productAttributes: attributes,
        existingVariants: [],
        variantKeys: ["size", "color"], // ✅ same keys as controller
      });

      const productType = variants.length ? "variable" : "simple";

      // ✅ stock logic
      let stock = Number(r.Stock || 0);
      let isInStock = String(r["In stock?"] || "").toLowerCase() === "1" || stock > 0;

      // if variable → sum variant stocks (if needed)
      if (productType === "variable" && variants.length) {
        const totalVariantStock = variants.reduce((s, v) => s + Number(v.stock || 0), 0);
        stock = totalVariantStock;
        isInStock = totalVariantStock > 0;
      }

      const doc = await Product.create({
        title,
        slug,
        shortDescription: r["Short description"] || "",
        description: r.Description || "",

        price,
        compareAtPrice,

        categories,
        tags,

        images,
        thumbnail,

        attributes,
        variants,

        stock,
        isInStock,

        isActive: true,
        isDraft: false,
      });

      created++;

      if (created % 25 === 0) {
        console.log(`✅ Created ${created} products...`);
      }
    } catch (e) {
      console.error("❌ Failed row:", i + 1, e.message);
    }
  }

  console.log("\n🎉 IMPORT DONE");
  console.log("✅ Created:", created);
  console.log("⏭️ Skipped:", skipped);

  process.exit(0);
}

run();
