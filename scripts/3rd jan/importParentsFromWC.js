import mongoose from "mongoose";
import csv from "csvtojson";
import slugify from "slugify";

import Product from "../../Products/Products.js";
import { generateVariants } from "../../utility/variants.js";

const MONGO_URI = process.env.MONGO_URI;

/**
 * ✅ helpers
 * - split by comma OR pipe (Woo sometimes exports with |)
 */
const arr = (v) =>
  !v
    ? []
    : Array.isArray(v)
    ? v
    : String(v)
        .split(/[,|]/)
        .map((x) => x.trim())
        .filter(Boolean);

const tagsNorm = (v) =>
  arr(v)
    .map((t) => String(t).trim().toLowerCase())
    .filter(Boolean);

const parseImages = (val) => {
  if (!val) return [];
  return String(val)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
};

// ✅ Woo CSV Attribute parser (normalized keys + values)
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
      .filter(Boolean)
      .map((v) => v.toLowerCase());

    if (!key || !vals.length) continue;

    attrs.push({
      key,
      values: vals,
    });
  }

  return attrs;
};

async function run() {
  if (!MONGO_URI) {
    console.error("❌ MONGO_URI is missing. Make sure you run with --env-file=.env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected MongoDB");

  /**
   * ✅ CSV path:
   * - You can pass as CLI arg:
   *   node --env-file=.env "scripts/3rd jan/importParentsFromWC.js" "scripts/3rd jan/export.csv"
   * - OR fallback to default hardcoded path here
   */
  const filePath =
    process.argv[2] ||
    "scripts/3rd jan/wc-product-export-3-1-2026-1767450524719.csv";

  console.log("📄 Using CSV:", filePath);

  const rows = await csv().fromFile(filePath);

  // ✅ Parents only (ignore "variation")
  const parents = rows.filter((r) => {
    const type = String(r.Type || "").toLowerCase();
    const name = String(r.Name || "").trim();
    return type !== "variation" && name.length;
  });

  console.log("📦 Total Rows:", rows.length);
  console.log("✅ Parent Rows:", parents.length);

  // ✅ preload all existing slugs once (fast)
  console.log("⏳ Loading existing products...");
  const existingSlugs = new Set(
    (await Product.find({}, { slug: 1 }).lean()).map((p) => p.slug)
  );
  console.log("✅ Existing products found:", existingSlugs.size);

  let created = 0;
  let skipped = 0;

  const failed = [];

  for (let i = 0; i < parents.length; i++) {
    const r = parents[i];

    const title = String(r.Name || "").trim();

    try {
      const slug = slugify(title, { lower: true, strict: true });

      // ✅ Skip if already exists
      if (existingSlugs.has(slug)) {
        skipped++;
        continue;
      }

      /**
       * ✅ Price mapping (correct ecommerce meaning)
       * - Regular price = compareAtPrice (MRP)
       * - Sale price = price (actual selling price)
       */
      const compareAtPrice = r["Regular price"]
        ? Number(r["Regular price"])
        : null;

      const price = r["Sale price"]
        ? Number(r["Sale price"])
        : Number(r["Regular price"] || 0);

      const categories = arr(r.Categories);
      const tags = tagsNorm(r.Tags);

      const images = parseImages(r.Images);
      const thumbnail = images[0] || "";

      const attributes = parseWCAttributes(r);

      // ✅ auto-generate variants using your existing utility
      const variants = generateVariants({
        productAttributes: attributes,
        existingVariants: [],
        variantKeys: ["size", "color"],
      });

      const productType = variants.length ? "variable" : "simple";

      /**
       * ✅ Stock logic (fixed)
       * - Keep parent stock from Woo CSV
       * - Do NOT overwrite stock with 0 by summing empty variant stock
       */
      let stock = Number(r.Stock || 0);
      let isInStock =
        String(r["In stock?"] || "").toLowerCase() === "1" || stock > 0;

      // ✅ Create product
      await Product.create({
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

        productType, // optional: if your schema supports
        isActive: true,
        isDraft: false,
      });

      // update in-memory slug cache
      existingSlugs.add(slug);

      created++;

      if (created % 25 === 0) {
        console.log(`✅ Created ${created} products...`);
      }
    } catch (e) {
      failed.push({
        row: i + 1,
        name: title,
        error: e.message,
      });
      console.error("❌ Failed row:", i + 1, "|", title, "|", e.message);
    }
  }

  console.log("\n🎉 IMPORT DONE");
  console.log("✅ Created:", created);
  console.log("⏭️ Skipped:", skipped);
  console.log("❌ Failed:", failed.length);

  if (failed.length) {
    console.log("\n📌 Failed rows summary:");
    console.table(failed.slice(0, 25)); // show first 25 failures max
    if (failed.length > 25) {
      console.log(`...and ${failed.length - 25} more`);
    }
  }

  process.exit(0);
}

run();
