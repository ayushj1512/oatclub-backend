import mongoose from "mongoose";
import dotenv from "dotenv";

import SizeChart from "../../SizeChart/SizeChart.js";
import Category from "../../Category/Category.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error("❌ Please set MONGO_URI in your .env file");
  process.exit(1);
}

/* =========================
   HELPERS
========================= */

async function getCategoryIds(slugsOrNames = []) {
  if (!slugsOrNames.length) return [];

  const cats = await Category.find({
    $or: [
      { name: { $in: slugsOrNames } },
      { slug: { $in: slugsOrNames } },
    ],
  }).select("_id name slug");

  const found = new Set(cats.map((c) => c.slug));

  const missing = slugsOrNames.filter((x) => !found.has(x) && !cats.find((c) => c.name === x));

  if (missing.length) {
    console.log("⚠️ Missing categories:", missing);
  }

  return cats.map((c) => c._id);
}

async function upsertSizeChart({ title, unit, headers, rows, note, categorySlugs }) {
  const categoryIds = await getCategoryIds(categorySlugs);

  const chart = await SizeChart.findOneAndUpdate(
    { title },
    {
      title,
      unit,
      headers,
      rows,
      note,
      categories: categoryIds,
    },
    { upsert: true, new: true, runValidators: true }
  );

  console.log(`✅ Upserted: ${title} | Assigned: ${categoryIds.length} categories`);
  return chart;
}

/* =========================
   SEED DATA (CM)
========================= */

const SIZE_CHARTS = [
  {
    title: "Topwear Size Chart (H&M Standard)",
    unit: "cm",
    headers: ["Size", "Bust", "Waist"],
    rows: [
      ["XS", "76–80", "60–64"],
      ["S", "84–88", "68–72"],
      ["M", "92–96", "76–80"],
      ["L", "100–104", "84–88"],
      ["XL", "110–116", "94–100"],
    ],
    note: "Standard women's topwear body measurements (cm).",
    categorySlugs: [
      "blazer",
      "blouse",
      "camisole",
      "corset",
      "hoodies",
      "jackets",
      "shirt",
      "t-shirts",
      "top",
      "sweatshirt",
      "crop-top",
      "long-sleeve",
      "tank-top",
    ],
  },
  {
    title: "Bottomwear Size Chart (H&M Standard)",
    unit: "cm",
    headers: ["Size", "Waist", "Hips"],
    rows: [
      ["XS", "60–64", "84–88"],
      ["S", "68–72", "92–96"],
      ["M", "76–80", "100–104"],
      ["L", "84–88", "108–112"],
      ["XL", "94–100", "116–122"],
    ],
    note: "Standard women's bottomwear body measurements (cm).",
    categorySlugs: [
      "bottom",
      "shorts",
      "skirt",
      "trousers",
      "leggings",
      "crossfit",
    ],
  },
  {
    title: "Dress & Partywear Size Chart (H&M Standard)",
    unit: "cm",
    headers: ["Size", "Bust", "Waist", "Hips"],
    rows: [
      ["XS", "76–80", "60–64", "84–88"],
      ["S", "84–88", "68–72", "92–96"],
      ["M", "92–96", "76–80", "100–104"],
      ["L", "100–104", "84–88", "108–112"],
      ["XL", "110–116", "94–100", "116–122"],
    ],
    note: "Standard women's dress & partywear body measurements (cm).",
    categorySlugs: [
      "dress",
      "evening-wear",
      "party-wear",
      "party",
      "festive-picks",
      "christmas",
      "winter-drops",
    ],
  },
  {
    title: "Co-Ord & Combo Size Chart (H&M Standard)",
    unit: "cm",
    headers: ["Size", "Bust", "Waist", "Hips"],
    rows: [
      ["XS", "76–80", "60–64", "84–88"],
      ["S", "84–88", "68–72", "92–96"],
      ["M", "92–96", "76–80", "100–104"],
      ["L", "100–104", "84–88", "108–112"],
      ["XL", "110–116", "94–100", "116–122"],
    ],
    note: "For co-ord and combo sets (top + bottom combined).",
    categorySlugs: ["co-ord-set", "combo"],
  },
  {
    title: "General Clothing Size Chart (H&M Standard)",
    unit: "cm",
    headers: ["Size", "Bust", "Waist", "Hips"],
    rows: [
      ["XS", "76–80", "60–64", "84–88"],
      ["S", "84–88", "68–72", "92–96"],
      ["M", "92–96", "76–80", "100–104"],
      ["L", "100–104", "84–88", "108–112"],
      ["XL", "110–116", "94–100", "116–122"],
    ],
    note: "Default chart for collection categories (mixed products).",
    categorySlugs: [
      "all-clothing",
      "best-sellers",
      "featured",
      "new-arrivals",
      "prints",
      "sale",
      "uncategorized",
    ],
  },
];

/* =========================
   RUN SEED
========================= */

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected!");

    for (const chart of SIZE_CHARTS) {
      await upsertSizeChart(chart);
    }

    console.log("🎉 Size Charts seeded successfully!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
  }
}

seed();
