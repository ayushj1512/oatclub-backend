// scripts/migrate-collection-products.js
// ✅ Converts old Collection.products: [productId, ...]
//    into new Collection.products: [{ product: <id>, productCode: <Product.productCode> }, ...]
//
// Run:
//   node scripts/migrate-collection-products.js
//
// Env required:
//   MONGO_URI="mongodb://...."

import mongoose from "mongoose";

// ✅ Adjust these imports if your file locations differ
import Collection from "../Collection/Collection.js";
import Product from "../Products/Products.js";

const MONGO_URI = "mongodb+srv://mirayayushjuneja_db_user:ltFjArxK5jncAJNH@cluster0.n7ehsrb.mongodb.net/miraydb?retryWrites=true&w=majority&appName=Cluster0"

const toIdStr = (v) => (v == null ? "" : String(v));
const isNewShape = (v) =>
  v &&
  typeof v === "object" &&
  "product" in v &&
  "productCode" in v &&
  v.product;

async function run() {
  if (!MONGO_URI) throw new Error("❌ MONGO_URI missing in env");

  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to MongoDB");

  const collections = await Collection.find({}).select("_id name products").lean();

  let updatedCount = 0;
  let skippedCount = 0;

  for (const col of collections) {
    if (!Array.isArray(col.products) || col.products.length === 0) {
      skippedCount++;
      continue;
    }

    // If already in new schema, skip
    if (isNewShape(col.products[0])) {
      skippedCount++;
      continue;
    }

    const ids = col.products.map(toIdStr).filter(Boolean);

    // Fetch Product.productCode for these ids
    const prodDocs = await Product.find({ _id: { $in: ids } })
      .select("_id productCode")
      .lean();

    const codeMap = new Map(prodDocs.map((p) => [toIdStr(p._id), toIdStr(p.productCode).trim()]));

    const newProducts = [];
    const missing = [];

    for (const id of ids) {
      const code = (codeMap.get(toIdStr(id)) || "").trim();
      if (!code) {
        missing.push(id);
        continue; // skip missing productCode
      }
      newProducts.push({ product: id, productCode: code });
    }

    await Collection.updateOne({ _id: col._id }, { $set: { products: newProducts } });

    updatedCount++;
    console.log(
      `✅ Migrated: ${col.name} (${col._id}) | total=${ids.length} migrated=${newProducts.length} missingCode=${missing.length}`
    );

    if (missing.length) {
      console.log("   ⚠️ Missing productCode for productIds:", missing.slice(0, 15));
    }
  }

  console.log("\n🎉 Migration complete");
  console.log("Updated collections:", updatedCount);
  console.log("Skipped collections:", skippedCount);

  await mongoose.disconnect();
  console.log("✅ Disconnected");
}

run().catch((e) => {
  console.error("❌ Migration failed:", e);
  process.exit(1);
});
