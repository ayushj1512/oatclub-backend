/**
 * Cleanup Product.categories by removing values that don't exist in Category collection.
 *
 * Run:
 *   node scripts/cleanupProductCategories.js --dry
 *   node scripts/cleanupProductCategories.js --apply
 *
 * Optional:
 *   --match=name   (if Product.categories stores Category.name instead of slug)
 *   --match=slug   (default)
 */

import "dotenv/config"; // ✅ loads .env automatically
import mongoose from "mongoose";
import Product from "../Products/Products.js";     // <-- adjust path
import Category from "../Category/Category.js";   // <-- adjust path

const args = process.argv.slice(2);
const isDry = args.includes("--dry");
const isApply = args.includes("--apply");
const matchArg = args.find((a) => a.startsWith("--match="));
const MATCH_BY = (matchArg ? matchArg.split("=")[1] : "slug"); // slug | name

if (!isDry && !isApply) {
  console.log("❗ Use one: --dry or --apply");
  process.exit(1);
}

const norm = (v) => String(v ?? "").trim().toLowerCase();

async function main() {
  const MONGO_URI = process.env.MONGO_URI; // ✅ from .env
  if (!MONGO_URI) {
    console.error("❌ Missing MONGO_URI in .env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected:", MONGO_URI);

  // 1) Load valid category keys (slug or name)
  const projection = MATCH_BY === "name" ? { name: 1 } : { slug: 1 };
  const cats = await Category.find({}, projection).lean();

  const valid = new Set(
    cats
      .map((c) => (MATCH_BY === "name" ? c.name : c.slug))
      .filter(Boolean)
      .map(norm)
  );

  console.log(`✅ Valid categories loaded: ${valid.size} (match by ${MATCH_BY})`);

  // 2) Iterate products with categories
  const cursor = Product.find({ "categories.0": { $exists: true } })
    .select({ categories: 1, title: 1, slug: 1 })
    .cursor();

  let scanned = 0;
  let changed = 0;
  let removedTotal = 0;

  for (let p = await cursor.next(); p != null; p = await cursor.next()) {
    scanned++;

    const before = Array.isArray(p.categories) ? p.categories : [];
    if (!before.length) continue;

    const after = before.filter((v) => valid.has(norm(v)));

    if (after.length !== before.length) {
      const removed = before.filter((v) => !valid.has(norm(v)));
      removedTotal += removed.length;

      if (isDry) {
        console.log("—".repeat(60));
        console.log(`🧾 Product: ${p.title || p.slug || p._id}`);
        console.log("Before :", before);
        console.log("After  :", after);
        console.log("Removed:", removed);
      } else {
        p.categories = after;
        await p.save();
      }

      changed++;
    }
  }

  console.log("\n========== SUMMARY ==========");
  console.log("Scanned products:", scanned);
  console.log("Products changed:", changed);
  console.log("Total categories removed:", removedTotal);
  console.log("Mode:", isDry ? "DRY" : "APPLY");
  console.log("Match by:", MATCH_BY);
  console.log("=============================\n");

  await mongoose.disconnect();
  console.log("✅ Done");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
