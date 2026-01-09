/**
 * scripts/categoryCleanup.js
 * -----------------------------------------
 * ✅ Removes product.categories entries that don't exist in Category collection
 * ✅ Normalizes category strings (case, spaces, > etc)
 * ✅ Keeps only valid categories
 * ✅ Ensures product has at least 1 category (fallback: "all-clothing" if exists)
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import Product from "../Products/Products.js";
import Category from "../Category/Category.js";
import fs from "fs";

const MONGO_URI = process.env.MONGO_URI;

// ✅ Normalize helper
const normalize = (str = "") =>
  str
    .toString()
    .trim()
    .toLowerCase()
    .replace(/>/g, "-")              // "Top > Crop Top" -> "top - crop top"
    .replace(/[^\w\s-]/g, "")       // remove special chars
    .replace(/\s+/g, "-")           // spaces -> hyphen
    .replace(/-+/g, "-");           // multiple hyphens -> single

async function run() {
  try {
    if (!MONGO_URI) {
      console.error("❌ MONGO_URI missing. Check .env");
      process.exit(1);
    }

    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected MongoDB");

    console.log("📦 Fetching categories...");
    const categories = await Category.find({}, { name: 1, slug: 1 }).lean();

    // ✅ valid category set
    const validSet = new Set();
    categories.forEach((c) => {
      if (c?.name) validSet.add(normalize(c.name));
      if (c?.slug) validSet.add(normalize(c.slug));
    });

    // ✅ fallback category
    const fallbackCategory = validSet.has("all-clothing") ? "all-clothing" : null;

    console.log("📦 Fetching products...");
    const products = await Product.find(
      { categories: { $exists: true } },
      { title: 1, slug: 1, categories: 1 }
    );

    let updatedCount = 0;
    let removedTotal = 0;

    const report = [];

    for (const p of products) {
      const beforeRaw = Array.isArray(p.categories) ? p.categories : [];
      const beforeNormalized = beforeRaw.map((x) => normalize(x)).filter(Boolean);

      // ✅ keep only valid categories
      let after = beforeNormalized.filter((x) => validSet.has(x));

      // ✅ remove duplicates
      after = [...new Set(after)];

      // ✅ removed count
      const removed = beforeNormalized.length - after.length;

      // ✅ ensure at least 1 category
      if (!after.length && fallbackCategory) {
        after = [fallbackCategory];
      }

      // ✅ if changed, update product
      const changed =
        removed > 0 ||
        JSON.stringify(after.sort()) !== JSON.stringify([...new Set(beforeNormalized)].sort());

      if (changed) {
        p.categories = after;
        await p.save();

        updatedCount++;
        removedTotal += Math.max(removed, 0);

        report.push({
          productId: p._id,
          title: p.title,
          slug: p.slug,
          before: beforeRaw,
          after,
          removedCount: Math.max(removed, 0),
        });

        console.log(
          `✅ Updated: ${p.title} | removed ${Math.max(removed, 0)} invalid categories`
        );
      }
    }

    // ✅ save report
    fs.writeFileSync(
      "./category-cleanup-report.json",
      JSON.stringify(
        {
          updatedCount,
          removedTotal,
          report,
        },
        null,
        2
      )
    );

    console.log("\n🎉 CLEANUP DONE");
    console.log("✅ Products updated:", updatedCount);
    console.log("🧹 Total invalid categories removed:", removedTotal);
    console.log("📄 Report saved: category-cleanup-report.json");

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
}

run();
