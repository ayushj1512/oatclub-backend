import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import slugify from "slugify";
import Category from "../models/Category.js"; // correct if scripts/ is at project root: scripts/ -> ../models

const MONGO_URI = process.env.MONGO_URI; // or process.env.DATABASE_URL etc.

const norm = (s) => String(s || "").trim().replace(/\s+/g, " ");
const slug = (s) => slugify(norm(s), { lower: true, strict: true });

function extractCategoryPaths(products) {
  const paths = [];

  for (const p of products) {
    const cats = Array.isArray(p?.categories) ? p.categories : [];
    for (const raw of cats) {
      const x = norm(raw);
      if (!x) continue;

      // "All Clothing > Tops > Crop Top"
      if (x.includes(">")) {
        const parts = x.split(">").map(norm).filter(Boolean);
        if (parts.length) paths.push(parts);
      } else {
        paths.push([x]);
      }
    }
  }

  return paths;
}

async function upsertOne({ name, parentId = null }) {
  const s = slug(name);

  await Category.updateOne(
    { slug: s },
    {
      $set: {
        name: norm(name),
        slug: s,
        parent: parentId,
        isActive: true,
      },
    },
    { upsert: true }
  );

  return Category.findOne({ slug: s }).select("_id name slug parent");
}

async function run() {
  if (!MONGO_URI) throw new Error("MONGO_URI missing in .env");

  // If you don't pass an arg, default to scripts/wc_products_intermediate.json
  const inputArg = process.argv[2];
  const input = inputArg
    ? path.resolve(process.cwd(), inputArg)
    : path.resolve(process.cwd(), "scripts", "wc_products_intermediate.json");

  if (!fs.existsSync(input)) {
    throw new Error(`Input file not found: ${input}`);
  }

  const raw = JSON.parse(fs.readFileSync(input, "utf-8"));
  const products = Array.isArray(raw?.products) ? raw.products : [];
  if (!products.length) {
    throw new Error("No products found in JSON (expected key: products[])");
  }

  const paths = extractCategoryPaths(products);

  // Dedupe by full path slug: parent>child>subchild
  const uniqKey = new Set();
  const uniqPaths = [];
  for (const p of paths) {
    const key = p.map(slug).join(">");
    if (uniqKey.has(key)) continue;
    uniqKey.add(key);
    uniqPaths.push(p);
  }

  console.log(`🧾 Products in file: ${products.length}`);
  console.log(`🗂️ Category paths found: ${paths.length} (unique: ${uniqPaths.length})`);

  await mongoose.connect(MONGO_URI);

  // Process left-to-right so parent exists before child
  const slugToId = new Map();

  for (const parts of uniqPaths) {
    let parentId = null;

    for (const name of parts) {
      const s = slug(name);

      // already created in this run
      if (slugToId.has(s)) {
        parentId = slugToId.get(s);
        continue;
      }

      // already exists in DB (maybe from earlier run)
      const existing = await Category.findOne({ slug: s }).select("_id slug");
      if (existing?._id) {
        slugToId.set(existing.slug, existing._id);
        parentId = existing._id;
        continue;
      }

      const doc = await upsertOne({ name, parentId });
      if (!doc?._id) throw new Error(`Failed to upsert category: ${name}`);

      slugToId.set(doc.slug, doc._id);
      parentId = doc._id;
    }
  }

  // Write map inside scripts folder
  const outMap = Object.fromEntries([...slugToId.entries()].map(([k, v]) => [k, String(v)]));
  const outPath = path.resolve(process.cwd(), "scripts", "categoryMap.json");
  fs.writeFileSync(outPath, JSON.stringify(outMap, null, 2));

  console.log(`✅ Categories processed (slug->id map size): ${slugToId.size}`);
  console.log(`✅ categoryMap.json written: ${outPath}`);

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error("❌ seedCategoriesFromWooJson failed:", e.message || e);
  process.exit(1);
});
