import "dotenv/config";
import mongoose from "mongoose";
import Product from "../../Products/Products.js";
import Attribute from "../../Attribute/Attribute.js";
import { generateUniqueSKU } from "../../utility/sku.js"; // ✅ used in controller
// If your path differs, tell me & I’ll adjust

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ Please set MONGO_URI in .env");
  process.exit(1);
}

const SIZES = ["XS", "S", "M", "L", "XL"];
const DEFAULT_VARIANT_STOCK = 100;

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log("✅ MongoDB connected");

  // ✅ Fetch "size" attribute from DB
  const sizeAttr = await Attribute.findOne({ slug: "size" }).lean();
  if (!sizeAttr) {
    console.error("❌ Size attribute not found in DB (slug=size)");
    process.exit(1);
  }

  console.log("✅ Size Attribute Found:", sizeAttr._id);

  // ✅ Fetch all products
  const products = await Product.find({}).select("_id title slug categories price variants attributes productType").lean();

  console.log("📦 Total products:", products.length);

  let updatedCount = 0;
  let skippedCount = 0;

  for (const p of products) {
    // ✅ Skip those already having variants and size
    if (Array.isArray(p.variants) && p.variants.length > 0) {
      skippedCount++;
      continue;
    }

    const categoryName =
      Array.isArray(p.categories) && p.categories.length
        ? String(p.categories[0]).toUpperCase()
        : "CAT";

    const title = String(p.title || p.slug || "PRODUCT").toUpperCase();

    // ✅ Create attributes block
    const attributes = [
      {
        attribute: sizeAttr._id,
        key: "Size",
        values: SIZES,
      },
    ];

    // ✅ Create variant objects
    const variants = [];

    for (const size of SIZES) {
      const sku = await generateUniqueSKU(Product, {
        brand: "MIR",
        category: categoryName,
        title,
        size,
      });

      variants.push({
        attributes: [{ key: "Size", value: size }],
        sku,
        barcode: "",
        price: Number(p.price ?? 0),
        compareAtPrice: null,
        stock: DEFAULT_VARIANT_STOCK,
        isInStock: true,
        weight: 0,
      });
    }

    const totalStock = variants.length * DEFAULT_VARIANT_STOCK;

    // ✅ Update product
    await Product.updateOne(
      { _id: p._id },
      {
        $set: {
          productType: "variable",
          attributes,
          variants,
          stock: totalStock,
          isInStock: true,
        },
      }
    );

    updatedCount++;
  }

  console.log("✅ Updated products:", updatedCount);
  console.log("⏭️ Skipped products (already had variants):", skippedCount);

  await mongoose.disconnect();
  console.log("🎉 Done");
}

run().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
