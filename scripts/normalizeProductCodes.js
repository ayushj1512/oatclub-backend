import mongoose from "mongoose";
import dotenv from "dotenv";

// 🔑 Load .env
dotenv.config();

// ✅ Product model path
import Product from "../Products/Products.js";

async function countProductCodes() {
  if (!process.env.MONGO_URI) {
    throw new Error("❌ MONGO_URI missing in .env");
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB connected");

  const fiveDigitCount = await Product.countDocuments({
    productCode: { $regex: /^\d{5}$/ },
  });

  const sixDigitCount = await Product.countDocuments({
    productCode: { $regex: /^\d{6}$/ },
  });

  const otherCount = await Product.countDocuments({
    productCode: { $not: /^\d{5,6}$/ },
  });

  console.log("\n📊 PRODUCT CODE COUNT");
  console.log("────────────────────────────");
  console.log(`🟡 5-digit product codes : ${fiveDigitCount}`);
  console.log(`🟢 6-digit product codes : ${sixDigitCount}`);
  console.log(`🔴 Other / invalid codes : ${otherCount}`);

  await mongoose.disconnect();
  console.log("\n✅ Count completed (read-only)");
}

countProductCodes().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
