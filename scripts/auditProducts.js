import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import Product from "../Products/Products.js";

const MONGO_URI = process.env.MONGO_URI;

const PATCH_FILE =
  process.argv[2] ||
  "C:/Users/croma/Downloads/oatclub-product-specifications-16-patches.json";

if (!MONGO_URI) {
  console.error("❌ MONGO_URI missing in .env");
  process.exit(1);
}

if (!fs.existsSync(PATCH_FILE)) {
  console.error("❌ JSON file not found:", PATCH_FILE);
  process.exit(1);
}

const normalizeKey = (key) =>
  String(key || "")
    .trim()
    .toLowerCase();

const mergeSpecifications = (existing = [], incoming = []) => {
  const merged = Array.isArray(existing) ? [...existing] : [];
  const existingKeys = new Set(merged.map((s) => normalizeKey(s.key)));

  for (const spec of incoming || []) {
    const key = String(spec?.key || "").trim();
    const value = String(spec?.value || "").trim();

    if (!key || !value) continue;

    // ✅ Do not overwrite existing spec key
    if (existingKeys.has(normalizeKey(key))) continue;

    merged.push({ key, value });
    existingKeys.add(normalizeKey(key));
  }

  return merged;
};

async function applyProductSpecifications() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected");

    const json = JSON.parse(fs.readFileSync(PATCH_FILE, "utf-8"));
    const products = json.products || [];

    let matched = 0;
    let updated = 0;
    let skipped = 0;

    for (const item of products) {
      const query = item._id
        ? { _id: item._id }
        : item.productCode
        ? { productCode: item.productCode }
        : { slug: item.slug };

      const product = await Product.findOne(query);

      if (!product) {
        skipped++;
        console.log(`⚠️ Not found: ${item.productCode || item.slug}`);
        continue;
      }

      matched++;

      const incomingSpecs = item.patch?.specifications || [];
      const beforeCount = product.specifications?.length || 0;
      const mergedSpecs = mergeSpecifications(
        product.specifications || [],
        incomingSpecs
      );

      if (mergedSpecs.length === beforeCount) {
        skipped++;
        console.log(`⏭️ Skipped: ${product.productCode} already has specs`);
        continue;
      }

      await Product.updateOne(
        { _id: product._id },
        { $set: { specifications: mergedSpecs } },
        { runValidators: true }
      );

      updated++;

      console.log(
        `✅ Updated ${product.productCode} | ${product.title} | ${beforeCount} → ${mergedSpecs.length}`
      );
    }

    console.log("\n🎉 Specifications patch completed");
    console.log({
      totalFromJson: products.length,
      matched,
      updated,
      skipped,
    });

    process.exit(0);
  } catch (error) {
    console.error("❌ Specifications patch failed:", error);
    process.exit(1);
  }
}

applyProductSpecifications();