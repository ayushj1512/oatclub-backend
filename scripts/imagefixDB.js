// ✅ If you are NOT using: node --env-file=.env
// import "dotenv/config";

import mongoose from "mongoose";
import Reel from "../../miray-backend/reels/Reels.js"; 
// ✅ PATH check: tumne bola reels/Reels.js

const MONGO_URI = process.env.MONGO_URI;

const OLD = "mirayfashions.com";
const NEW = "mirayfashions.in";

// ✅ DRY_RUN=true => only logs, no save
const DRY_RUN = process.env.DRY_RUN === "true";

const hasOld = (val) => typeof val === "string" && val.includes(OLD);

const fixDomain = (val) => {
  if (!val || typeof val !== "string") return val;
  return val.replaceAll(OLD, NEW);
};

async function run() {
  try {
    if (!MONGO_URI) {
      console.error("❌ MONGO_URI missing in .env");
      process.exit(1);
    }

    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected MongoDB");
    console.log(`🔁 Replacing ${OLD} ➜ ${NEW}`);
    console.log("🧪 DRY_RUN:", DRY_RUN);

    console.log("⏳ Finding affected reels...");

    // ✅ Only those where old domain exists in known URL fields
    const cursor = Reel.find({
      $or: [
        { src: { $regex: OLD } },
        { poster: { $regex: OLD } },
        { "product.image": { $regex: OLD } },
        { "product.href": { $regex: OLD } },
        { caption: { $regex: OLD } },
        { notes: { $regex: OLD } },
      ],
    }).cursor();

    let scanned = 0;
    let updated = 0;

    for await (const r of cursor) {
      scanned++;
      let changed = false;

      // ✅ video src
      if (hasOld(r.src)) {
        r.src = fixDomain(r.src);
        changed = true;
      }

      // ✅ poster
      if (hasOld(r.poster)) {
        r.poster = fixDomain(r.poster);
        changed = true;
      }

      // ✅ product snapshot image
      if (hasOld(r?.product?.image)) {
        r.product.image = fixDomain(r.product.image);
        changed = true;
      }

      // ✅ product href if stored
      if (hasOld(r?.product?.href)) {
        r.product.href = fixDomain(r.product.href);
        changed = true;
      }

      // ✅ optional text fields
      if (hasOld(r.caption)) {
        r.caption = fixDomain(r.caption);
        changed = true;
      }

      if (hasOld(r.notes)) {
        r.notes = fixDomain(r.notes);
        changed = true;
      }

      if (changed) {
        updated++;

        if (!DRY_RUN) {
          await r.save();
        }

        console.log(`✅ Updated reel: ${r.title || r.slug} (${r._id})`);
      }

      if (scanned % 25 === 0) {
        console.log(`⏳ Scanned: ${scanned} | Updated: ${updated}`);
      }
    }

    console.log("\n🎉 DONE ✅");
    console.log("📌 Total scanned:", scanned);
    console.log("✅ Total updated:", updated);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}

run();
