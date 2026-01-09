import mongoose from "mongoose";

import Category from "../Category/Category.js";
import SizeChart from "../SizeChart/SizeChart.js";

const MONGO_URI = process.env.MONGO_URI;

async function run() {
  if (!MONGO_URI) {
    console.error("❌ MONGO_URI missing. Run with --env-file=.env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected MongoDB");

  // ✅ load valid categories
  const categories = await Category.find({}, { _id: 1 }).lean();
  const validSet = new Set(categories.map((c) => String(c._id)));

  const charts = await SizeChart.find({}, { title: 1, categories: 1 });

  let updated = 0;
  let removedTotal = 0;

  for (const chart of charts) {
    const before = (chart.categories || []).map(String);

    const after = before.filter((id) => validSet.has(id));

    const removed = before.length - after.length;

    if (removed > 0) {
      chart.categories = after;
      await chart.save();

      updated++;
      removedTotal += removed;

      console.log(
        `✅ Cleaned "${chart.title}" | removed ${removed} orphan IDs`
      );
    }
  }

  console.log("\n🎉 CLEANUP DONE");
  console.log("✅ SizeCharts updated:", updated);
  console.log("🧹 Total orphan IDs removed:", removedTotal);

  process.exit(0);
}

run();