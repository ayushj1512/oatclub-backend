import mongoose from "mongoose";
import Product from "../../Products/Products.js"; // ✅ adjust if your path differs
import { htmlToText } from "html-to-text";
import "dotenv/config";

const MONGO_URI = process.env.MONGO_URI; // keep using your existing .env

if (!MONGO_URI) {
  console.error("❌ Please set MONGO_URI in .env");
  process.exit(1);
}

function cleanHTML(html = "") {
  if (!html) return "";

  // html-to-text converts tags into readable plain text
  let text = htmlToText(String(html), {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
    ],
  });

  // remove escaped \n and extra spaces
  text = text
    .replace(/\\n/g, " ")
    .replace(/\r|\n|\t/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return text;
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log("✅ Mongo connected");

  // Only products having description
  const cursor = Product.find({
    description: { $type: "string", $ne: "" },
  })
    .select("_id description")
    .lean()
    .cursor();

  let count = 0;
  let updated = 0;

  const bulkOps = [];

  for await (const doc of cursor) {
    count++;
    const cleaned = cleanHTML(doc.description);

    if (cleaned !== doc.description) {
      bulkOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { description: cleaned } },
        },
      });
      updated++;
    }

    // Bulk write every 500 updates
    if (bulkOps.length >= 500) {
      await Product.bulkWrite(bulkOps);
      console.log(`✅ Updated batch: ${bulkOps.length}`);
      bulkOps.length = 0;
    }
  }

  if (bulkOps.length) {
    await Product.bulkWrite(bulkOps);
    console.log(`✅ Updated final batch: ${bulkOps.length}`);
  }

  console.log("📦 Total checked:", count);
  console.log("✅ Total cleaned:", updated);

  await mongoose.disconnect();
  console.log("🎉 Done");
}

run().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
