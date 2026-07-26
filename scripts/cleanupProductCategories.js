// scripts/cleanupProductCategories.js

import "dotenv/config";
import mongoose from "mongoose";

import Product from "../Products/Products.js";
import Category from "../Category/Category.js";

/* =========================================================
   CONFIG
========================================================= */

const DRY_RUN = false;
const ADD_PARENT_CATEGORY = true;

const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.DB_URI;

if (!MONGO_URI) {
  throw new Error(
    "MongoDB URI missing. Add MONGO_URI or MONGODB_URI in .env"
  );
}

/* =========================================================
   HELPERS
========================================================= */

const cleanText = (value = "") =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ");

const normalize = (value = "") =>
  cleanText(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[_/\\-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const getCategoryValue = (category) => {
  if (!category) return "";

  if (typeof category === "string") {
    return category;
  }

  return (
    category.name ||
    category.slug ||
    category.title ||
    category._id ||
    ""
  );
};

/* =========================================================
   WRONG CATEGORY → VALID CATEGORY
========================================================= */

const CATEGORY_ALIASES = {
  apparel: null,
  clothing: null,
  fashion: null,
  womenswear: null,
  "women apparel": null,
  "women clothing": null,

  top: "Tops",
  tops: "Tops",

  "crop top": "Crop Tops",
  "crop tops": "Crop Tops",
  "cropped top": "Crop Tops",
  "cropped tops": "Crop Tops",

  "tank top": "Tank Tops",
  "tank tops": "Tank Tops",
  camisole: "Tank Tops",
  camisoles: "Tank Tops",

  tshirt: "T-Shirts",
  tshirts: "T-Shirts",
  "t shirt": "T-Shirts",
  "t shirts": "T-Shirts",
  tee: "T-Shirts",
  tees: "T-Shirts",

  shirt: "Shirts",
  shirts: "Shirts",

  blouse: "Blouses",
  blouses: "Blouses",

  corset: "Corset Tops",
  "corset top": "Corset Tops",
  "corset tops": "Corset Tops",

  "halter top": "Tops",
  "halter tops": "Tops",

  "one shoulder top": "Tops",
  "one shoulder tops": "Tops",

  "off shoulder top": "Tops",
  "off shoulder tops": "Tops",

  dress: "Dresses",
  dresses: "Dresses",

  "mini dress": "Mini Dresses",
  "mini dresses": "Mini Dresses",

  "midi dress": "Midi Dresses",
  "midi dresses": "Midi Dresses",

  "maxi dress": "Maxi Dresses",
  "maxi dresses": "Maxi Dresses",
  "long dress": "Maxi Dresses",
  "long dresses": "Maxi Dresses",

  bodycon: "Bodycon Dresses",
  "bodycon dress": "Bodycon Dresses",
  "bodycon dresses": "Bodycon Dresses",

  "party dress": "Party Dresses",
  "party dresses": "Party Dresses",
  "evening dress": "Party Dresses",
  "evening dresses": "Party Dresses",

  "vacation dress": "Vacation Dresses",
  "vacation dresses": "Vacation Dresses",
  "resort dress": "Vacation Dresses",
  "resort dresses": "Vacation Dresses",

  coord: "Co-Ord Sets",
  coords: "Co-Ord Sets",
  "co ord": "Co-Ord Sets",
  "co ords": "Co-Ord Sets",
  "co ord set": "Co-Ord Sets",
  "co ord sets": "Co-Ord Sets",
  "coord set": "Co-Ord Sets",
  "coord sets": "Co-Ord Sets",
  "matching set": "Co-Ord Sets",
  "matching sets": "Co-Ord Sets",
  "two piece set": "Co-Ord Sets",
  "two piece sets": "Co-Ord Sets",
  "skirt set": "Co-Ord Sets",
  "skirt sets": "Co-Ord Sets",

  "casual coord": "Casual Co-Ords",
  "casual coords": "Casual Co-Ords",
  "casual co ord": "Casual Co-Ords",
  "casual co ords": "Casual Co-Ords",

  "vacation coord": "Vacation Co-Ords",
  "vacation coords": "Vacation Co-Ords",
  "vacation co ord": "Vacation Co-Ords",
  "vacation co ords": "Vacation Co-Ords",
  "resort coord": "Vacation Co-Ords",
  "resort coords": "Vacation Co-Ords",

  "lounge coord": "Lounge Co-Ords",
  "lounge coords": "Lounge Co-Ords",
  "lounge co ord": "Lounge Co-Ords",
  "lounge co ords": "Lounge Co-Ords",
  loungewear: "Lounge Co-Ords",

  "party coord": "Party Co-Ords",
  "party coords": "Party Co-Ords",
  "party co ord": "Party Co-Ords",
  "party co ords": "Party Co-Ords",

  bottom: "Bottoms",
  bottoms: "Bottoms",
  bottomwear: "Bottoms",
  "bottom wear": "Bottoms",

  jean: "Jeans",
  jeans: "Jeans",
  denim: "Jeans",

  trouser: "Trousers",
  trousers: "Trousers",
  pant: "Trousers",
  pants: "Trousers",

  "wide leg trouser": "Wide Leg Pants",
  "wide leg trousers": "Wide Leg Pants",
  "wide leg pant": "Wide Leg Pants",
  "wide leg pants": "Wide Leg Pants",
  palazzo: "Wide Leg Pants",
  palazzos: "Wide Leg Pants",

  cargo: "Cargo Pants",
  cargos: "Cargo Pants",
  "cargo pant": "Cargo Pants",
  "cargo pants": "Cargo Pants",

  short: "Shorts",
  shorts: "Shorts",

  skirt: "Skirts",
  skirts: "Skirts",
};

const normalizedAliases = new Map(
  Object.entries(CATEGORY_ALIASES).map(([key, value]) => [
    normalize(key),
    value,
  ])
);

/* =========================================================
   AMBIGUOUS CATEGORY RESOLVER
========================================================= */

const resolveAmbiguousCategory = (category, product) => {
  const normalizedCategory = normalize(category);

  const searchableText = normalize(
    [
      product.title,
      product.shortDescription,
      product.howToStyle,
      ...(Array.isArray(product.tags) ? product.tags : []),
      ...(Array.isArray(product.keywords) ? product.keywords : []),
    ]
      .filter(Boolean)
      .join(" ")
  );

  if (
    normalizedCategory === "resort wear" ||
    normalizedCategory === "vacation wear"
  ) {
    const isCoord =
      searchableText.includes("co ord") ||
      searchableText.includes("coord") ||
      searchableText.includes("two piece") ||
      searchableText.includes("matching set");

    const isDress =
      searchableText.includes("dress") ||
      searchableText.includes("gown");

    if (isCoord) return "Vacation Co-Ords";
    if (isDress) return "Vacation Dresses";

    return null;
  }

  return undefined;
};

/* =========================================================
   MAIN
========================================================= */

async function main() {
  try {
    await mongoose.connect(MONGO_URI);

    console.log("✅ MongoDB connected");
    console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE UPDATE"}`);

    const categories = await Category.find({
      isActive: { $ne: false },
    })
      .select("_id name slug parent")
      .lean();

    const categoryById = new Map();
    const categoryByName = new Map();
    const categoryBySlug = new Map();

    for (const category of categories) {
      categoryById.set(String(category._id), category);
      categoryByName.set(normalize(category.name), category);
      categoryBySlug.set(normalize(category.slug), category);
    }

    const resolveCategory = (rawCategory, product) => {
      const rawValue = getCategoryValue(rawCategory);
      const normalizedValue = normalize(rawValue);

      if (!normalizedValue) return null;

      const exactByName = categoryByName.get(normalizedValue);

      if (exactByName) {
        return exactByName.name;
      }

      const exactBySlug = categoryBySlug.get(normalizedValue);

      if (exactBySlug) {
        return exactBySlug.name;
      }

      if (normalizedAliases.has(normalizedValue)) {
        const mappedName = normalizedAliases.get(normalizedValue);

        if (!mappedName) {
          return null;
        }

        const realCategory = categoryByName.get(
          normalize(mappedName)
        );

        return realCategory?.name || null;
      }

      const ambiguous = resolveAmbiguousCategory(
        rawValue,
        product
      );

      if (ambiguous !== undefined) {
        const realCategory = categoryByName.get(
          normalize(ambiguous)
        );

        return realCategory?.name || null;
      }

      return null;
    };

    const addParents = (categoryNames) => {
      if (!ADD_PARENT_CATEGORY) {
        return categoryNames;
      }

      const result = [];

      for (const categoryName of categoryNames) {
        const category = categoryByName.get(
          normalize(categoryName)
        );

        if (category?.parent) {
          const parent = categoryById.get(
            String(category.parent)
          );

          if (parent?.name) {
            result.push(parent.name);
          }
        }

        result.push(categoryName);
      }

      return [...new Set(result)];
    };

    const products = await Product.find({})
      .select(
        "_id productCode title shortDescription howToStyle tags keywords categories"
      )
      .lean();

    const operations = [];
    const changedProducts = [];
    const removedCategories = {};
    const mappedCategories = {};

    for (const product of products) {
      const oldCategories = Array.isArray(product.categories)
        ? product.categories
        : [];

      const resolved = [];

      for (const rawCategory of oldCategories) {
        const oldValue = cleanText(
          getCategoryValue(rawCategory)
        );

        if (!oldValue) continue;

        const finalCategory = resolveCategory(
          rawCategory,
          product
        );

        if (!finalCategory) {
          removedCategories[oldValue] =
            (removedCategories[oldValue] || 0) + 1;

          continue;
        }

        if (normalize(oldValue) !== normalize(finalCategory)) {
          const key = `${oldValue} → ${finalCategory}`;

          mappedCategories[key] =
            (mappedCategories[key] || 0) + 1;
        }

        resolved.push(finalCategory);
      }

      const finalCategories = addParents([
        ...new Set(resolved),
      ]);

      const oldComparable = oldCategories
        .map((category) =>
          cleanText(getCategoryValue(category))
        )
        .filter(Boolean);

      const oldSorted = [...oldComparable].sort();
      const finalSorted = [...finalCategories].sort();

      const changed =
        JSON.stringify(oldSorted) !==
        JSON.stringify(finalSorted);

      if (!changed) continue;

      changedProducts.push({
        productCode: product.productCode,
        title: product.title,
        before: oldComparable,
        after: finalCategories,
      });

      operations.push({
        updateOne: {
          filter: { _id: product._id },
          update: {
            $set: {
              categories: finalCategories,
            },
          },
        },
      });
    }

    console.log("\n==============================");
    console.log("CATEGORY CLEANUP REPORT");
    console.log("==============================");

    console.log(`Products scanned: ${products.length}`);
    console.log(
      `Products needing update: ${operations.length}`
    );

    console.log("\nMapped categories:");

    if (Object.keys(mappedCategories).length) {
      console.table(
        Object.entries(mappedCategories).map(
          ([mapping, count]) => ({
            mapping,
            count,
          })
        )
      );
    } else {
      console.log("None");
    }

    console.log("\nRemoved invalid categories:");

    if (Object.keys(removedCategories).length) {
      console.table(
        Object.entries(removedCategories).map(
          ([category, count]) => ({
            category,
            count,
          })
        )
      );
    } else {
      console.log("None");
    }

    console.log("\nChanged products:");

    changedProducts.slice(0, 100).forEach((product) => {
      console.log(
        `\n${product.productCode || "NO-CODE"} | ${
          product.title
        }`
      );

      console.log("Before:", product.before);
      console.log("After :", product.after);
    });

    if (changedProducts.length > 100) {
      console.log(
        `\nShowing first 100 of ${changedProducts.length} changed products`
      );
    }

    if (DRY_RUN) {
      console.log(
        "\n⚠️ DRY RUN complete. Database was not changed."
      );
      console.log(
        "Set DRY_RUN = false and run again to update products."
      );

      return;
    }

    if (!operations.length) {
      console.log("\n✅ Nothing to update.");
      return;
    }

    const result = await Product.bulkWrite(operations, {
      ordered: false,
    });

    console.log("\n✅ Database updated");
    console.log({
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("\n❌ Cleanup failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("\nMongoDB disconnected");
  }
}

main();