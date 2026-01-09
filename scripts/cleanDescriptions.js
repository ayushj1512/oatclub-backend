import mongoose from "mongoose";
import Product from "../../miray-backend/Products/Products.js";

const MONGO_URI = process.env.MONGO_URI;

/**
 * ✅ Clean HTML coming from editor / WC export
 * - removes data-path-to-node="..."
 * - removes data-index-in-node="..."
 * - converts "\\n" into "\n"
 */
const cleanHTML = (html) => {
  if (!html || typeof html !== "string") return html;

  let cleaned = html;

  cleaned = cleaned.replace(/\s?data-path-to-node="[^"]*"/g, "");
  cleaned = cleaned.replace(/\s?data-index-in-node="[^"]*"/g, "");
  cleaned = cleaned.replace(/\\n/g, "\n");

  return cleaned.trim();
};

async function run() {
  if (!MONGO_URI) {
    console.error("❌ MONGO_URI is missing. Make sure you run with --env-file=.env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected MongoDB");

  // ✅ Only fetch products where dirty attributes exist
  console.log("⏳ Finding dirty products...");

  const dirtyProducts = await Product.find(
    {
      $or: [
        { shortDescription: { $regex: "data-path-to-node|data-index-in-node" } },
        { description: { $regex: "data-path-to-node|data-index-in-node" } },
      ],
    },
    { shortDescription: 1, description: 1, title: 1 }
  ).lean();

  console.log("✅ Dirty products found:", dirtyProducts.length);

  if (!dirtyProducts.length) {
    console.log("🎉 Nothing to clean. Exiting...");
    process.exit(0);
  }

  const bulkOps = [];

  let changedCount = 0;

  for (let i = 0; i < dirtyProducts.length; i++) {
    const p = dirtyProducts[i];

    const newShort = cleanHTML(p.shortDescription || "");
    const newDesc = cleanHTML(p.description || "");

    // ✅ Skip if no change
    if (newShort === (p.shortDescription || "") && newDesc === (p.description || "")) {
      continue;
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: p._id },
        update: {
          $set: {
            shortDescription: newShort,
            description: newDesc,
          },
        },
      },
    });

    changedCount++;

    if (changedCount % 50 === 0) {
      console.log(`✅ Prepared ${changedCount} updates...`);
    }
  }

  console.log("📌 Final updates to apply:", bulkOps.length);

  if (!bulkOps.length) {
    console.log("🎉 No changes needed after cleaning.");
    process.exit(0);
  }

  // ✅ Bulk write (fast)
  console.log("⏳ Running bulkWrite...");
  const res = await Product.bulkWrite(bulkOps);

  console.log("\n🎉 CLEANING DONE");
  console.log("✅ Matched:", res.matchedCount);
  console.log("✅ Modified:", res.modifiedCount);

  process.exit(0);
}

run();
