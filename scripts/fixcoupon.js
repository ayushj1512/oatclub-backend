import "dotenv/config";

import dns from "dns";
import mongoose from "mongoose";

import Coupon from "../Coupon/Coupon.js";
import Counter from "../models/Counter.js";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.DATABASE_URL;

const COUNTER_NAME = "coupon";
const PAD = 3;

const pad = (num) => String(num).padStart(PAD, "0");

const parseNum = (val) => {
  const n = Number(String(val || "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
};

async function run() {
  try {
    if (!MONGO_URI) throw new Error("Mongo URI missing");

    await mongoose.connect(MONGO_URI);
    console.log("✅ DB Connected");

    const existing = await Coupon.find({
      couponNumber: { $exists: true, $nin: [null, ""] },
    })
      .select("couponNumber")
      .lean();

    let max = existing.reduce(
      (acc, c) => Math.max(acc, parseNum(c.couponNumber)),
      0
    );

    console.log("📊 Current max:", max);

    const missing = await Coupon.find({
      $or: [
        { couponNumber: { $exists: false } },
        { couponNumber: null },
        { couponNumber: "" },
      ],
    }).sort({ createdAt: 1, _id: 1 });

    console.log("🔎 Missing:", missing.length);

    for (const coupon of missing) {
      max += 1;

      coupon.couponNumber = pad(max);

      coupon.autoApply = coupon.autoApply ?? false;
      coupon.visibility = coupon.visibility || "public";
      coupon.categories = Array.isArray(coupon.categories) ? coupon.categories : [];
      coupon.collections = Array.isArray(coupon.collections)
        ? coupon.collections
        : [];

      coupon.cartRule = {
        enabled: coupon.cartRule?.enabled ?? false,
        ruleType: coupon.cartRule?.ruleType || "none",
        requiresPrimaryProduct:
          coupon.cartRule?.requiresPrimaryProduct ?? false,
        requiresSecondaryProduct:
          coupon.cartRule?.requiresSecondaryProduct ?? false,
        discountTarget: coupon.cartRule?.discountTarget || "cart",
        matchMode: coupon.cartRule?.matchMode || "any",
        applyToAllEligibleItems:
          coupon.cartRule?.applyToAllEligibleItems !== false,
      };

      coupon.targetEmail = coupon.targetEmail ?? null;
      coupon.targetPhone = coupon.targetPhone ?? null;

      await coupon.save();

      console.log(`✅ ${coupon.code} → #${coupon.couponNumber}`);
    }

    await Counter.findOneAndUpdate(
      { name: COUNTER_NAME },
      { $set: { seq: max } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log("🎯 Counter synced:", max);
    console.log("🚀 Done");
  } catch (err) {
    console.error("❌ ERROR:", err.message);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 DB Disconnected");
  }
}

run();