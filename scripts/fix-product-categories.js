import "dotenv/config";
import mongoose from "mongoose";

/* -------------------------------------------------------
   CONFIG
------------------------------------------------------- */

const DRY_RUN = !process.argv.includes("--apply");

const TOP_CATEGORY_ALIASES = new Set([
  "top",
  "tops",

  "camisole",
  "camisoles",

  "crop top",
  "crop tops",
  "crop-top",
  "crop-tops",

  "halter top",
  "halter tops",
  "halter-top",
  "halter-tops",

  "wrap top",
  "wrap tops",
  "wrap-top",
  "wrap-tops",

  "tank top",
  "tank tops",
  "tank-top",
  "tank-tops",

  "corset top",
  "corset tops",
  "corset-top",
  "corset-tops",

  "shirt",
  "shirts",

  "blouse",
  "blouses",

  "shirts & blouses",
  "shirts-and-blouses",

  "t-shirt",
  "t-shirts",
]);

const DRESS_CATEGORY_ALIASES = new Set([
  "dress",
  "dresses",

  "mini dress",
  "mini dresses",
  "mini-dress",
  "mini-dresses",

  "midi dress",
  "midi dresses",
  "midi-dress",
  "midi-dresses",

  "maxi dress",
  "maxi dresses",
  "maxi-dress",
  "maxi-dresses",

  "knitted dress",
  "knitted dresses",
  "knitted-dress",
  "knitted-dresses",

  "halter mini dress",
  "halter mini dresses",
  "halter-mini-dress",
  "halter-mini-dresses",

  "bodycon dress",
  "bodycon dresses",
  "bodycon-dress",
  "bodycon-dresses",

  "party dress",
  "party dresses",
  "party-dress",
  "party-dresses",

  "vacation dress",
  "vacation dresses",
  "vacation-dress",
  "vacation-dresses",
]);

const COORD_CATEGORY_ALIASES = new Set([
  "co ord",
  "co ords",
  "co-ord",
  "co-ords",
  "co ord set",
  "co ord sets",
  "co-ord-set",
  "co-ord-sets",

  "casual co ord",
  "casual co ords",
  "casual-co-ord",
  "casual-co-ords",

  "vacation co ord",
  "vacation co ords",
  "vacation-co-ord",
  "vacation-co-ords",

  "lounge co ord",
  "lounge co ords",
  "lounge-co-ord",
  "lounge-co-ords",

  "party co ord",
  "party co ords",
  "party-co-ord",
  "party-co-ords",
]);

/* -------------------------------------------------------
   HELPERS
------------------------------------------------------- */

const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s*&\s*/g, " & ")
    .replace(/\s+/g, " ");

const slugify = (value) =>
  normalizeText(value)
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const matchesAlias = (value, aliases) => {
  const normalized = normalizeText(value);
  const slug = slugify(value);

  return aliases.has(normalized) || aliases.has(slug);
};

const normalizeKnownCategory = (value) => {
  const normalized = normalizeText(value);
  const slug = slugify(value);

  const exactMap = {
    apparel: "apparel",

    tops: "tops",
    top: "tops",

    dresses: "dresses",
    dress: "dresses",

    "crop-tops": "crop-tops",
    "crop-top": "crop-tops",

    camisoles: "camisoles",
    camisole: "camisoles",

    "halter-tops": "halter-tops",
    "halter-top": "halter-tops",

    "wrap-tops": "wrap-tops",
    "wrap-top": "wrap-tops",

    "tank-tops": "tank-tops",
    "tank-top": "tank-tops",

    "corset-tops": "corset-tops",
    "corset-top": "corset-tops",

    shirts: "shirts",
    shirt: "shirts",

    blouses: "blouses",
    blouse: "blouses",

    "shirts-and-blouses": "shirts-and-blouses",

    "mini-dresses": "mini-dresses",
    "mini-dress": "mini-dresses",

    "midi-dresses": "midi-dresses",
    "midi-dress": "midi-dresses",

    "maxi-dresses": "maxi-dresses",
    "maxi-dress": "maxi-dresses",

    "knitted-dresses": "knitted-dresses",
    "knitted-dress": "knitted-dresses",

    "halter-mini-dresses": "halter-mini-dresses",
    "halter-mini-dress": "halter-mini-dresses",

    "bodycon-dresses": "bodycon-dresses",
    "bodycon-dress": "bodycon-dresses",

    "party-dresses": "party-dresses",
    "party-dress": "party-dresses",

    "vacation-dresses": "vacation-dresses",
    "vacation-dress": "vacation-dresses",

    "co-ord-sets": "co-ord-sets",
    "co-ord-set": "co-ord-sets",

    "casual-co-ords": "casual-co-ords",
    "casual-co-ord": "casual-co-ords",

    "vacation-co-ords": "vacation-co-ords",
    "vacation-co-ord": "vacation-co-ords",

    "lounge-co-ords": "lounge-co-ords",
    "lounge-co-ord": "lounge-co-ords",

    "party-co-ords": "party-co-ords",
    "party-co-ord": "party-co-ords",
  };

  return exactMap[normalized] || exactMap[slug] || slug;
};

function buildFixedCategories(categories) {
  const source = Array.isArray(categories) ? categories : [];

  const cleaned = source
    .map(normalizeKnownCategory)
    .filter(Boolean);

  const hasTopCategory = source.some((category) =>
    matchesAlias(category, TOP_CATEGORY_ALIASES)
  );

  const hasDressCategory = source.some((category) =>
    matchesAlias(category, DRESS_CATEGORY_ALIASES)
  );

  const hasCoordCategory = source.some((category) =>
    matchesAlias(category, COORD_CATEGORY_ALIASES)
  );

  if (hasTopCategory) {
    cleaned.push("tops");
  }

  if (hasDressCategory) {
    cleaned.push("dresses");
  }

  if (hasCoordCategory) {
    cleaned.push("co-ord-sets");
  }

  return [...new Set(cleaned)];
}

const arraysEqual = (a = [], b = []) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/* -------------------------------------------------------
   MAIN
------------------------------------------------------- */

async function run() {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error("MONGO_URI is missing in .env");
  }

  console.log(`\nMode: ${DRY_RUN ? "DRY RUN" : "APPLY CHANGES"}`);
  console.log("Connecting to MongoDB...\n");

  await mongoose.connect(mongoUri);

  const db = mongoose.connection.db;
  const products = db.collection("products");

  const cursor = products.find(
    {},
    {
      projection: {
        productCode: 1,
        title: 1,
        categories: 1,
      },
    }
  );

  let scanned = 0;
  let changed = 0;
  let unchanged = 0;
  let failed = 0;

  const operations = [];

  for await (const product of cursor) {
    scanned += 1;

    try {
      const oldCategories = Array.isArray(product.categories)
        ? product.categories
        : [];

      const newCategories = buildFixedCategories(oldCategories);

      if (arraysEqual(oldCategories, newCategories)) {
        unchanged += 1;
        continue;
      }

      changed += 1;

      console.log("--------------------------------------------------");
      console.log(
        `${product.productCode || product._id} | ${product.title || "Untitled"}`
      );
      console.log("OLD:", oldCategories);
      console.log("NEW:", newCategories);

      operations.push({
        updateOne: {
          filter: { _id: product._id },
          update: {
            $set: {
              categories: newCategories,
              updatedAt: new Date(),
            },
          },
        },
      });

      if (!DRY_RUN && operations.length >= 500) {
        const result = await products.bulkWrite(operations, {
          ordered: false,
        });

        console.log(`\nBatch updated: ${result.modifiedCount}\n`);
        operations.length = 0;
      }
    } catch (error) {
      failed += 1;
      console.error(
        `Failed product ${product.productCode || product._id}:`,
        error.message
      );
    }
  }

  if (!DRY_RUN && operations.length > 0) {
    const result = await products.bulkWrite(operations, {
      ordered: false,
    });

    console.log(`\nFinal batch updated: ${result.modifiedCount}\n`);
  }

  console.log("\n================ SUMMARY ================");
  console.log(`Scanned:   ${scanned}`);
  console.log(`Changed:   ${changed}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log(`Failed:    ${failed}`);

  if (DRY_RUN) {
    console.log("\nNo database changes were made.");
    console.log("Run with --apply after checking the output:");
    console.log("node scripts/fix-product-categories.js --apply");
  } else {
    console.log("\nCategory cleanup completed successfully.");
  }

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("\nScript failed:", error);

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  process.exit(1);
});