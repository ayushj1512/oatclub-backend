// scripts/createMissingVariants.js

import mongoose from "mongoose";
import Product from "../Products/Products.js";

const MONGO_URI =
  "mongodb+srv://ayushoatclub_db_user:Oatclub@cluster0oatclub.mvnkh5i.mongodb.net/oatclub?retryWrites=true&w=majority&appName=Cluster0Oatclub";

const SIZES = ["XS", "S", "M", "L", "XL"];

async function run() {
  try {
    await mongoose.connect(MONGO_URI);

    console.log("✅ Mongo Connected");

    const products = await Product.find({
      $or: [
        { variants: { $exists: false } },
        { variants: { $size: 0 } },
      ],
    });

    console.log(`Found ${products.length} products without variants`);

    let updated = 0;

    for (const product of products) {
      const baseSku =
        product.sku && String(product.sku).trim()
          ? String(product.sku).trim()
          : `APP-${product.productCode}`;

      const hasSizeAttribute = product.attributes?.some(
        (attr) => String(attr?.key || "").toLowerCase() === "size"
      );

      if (!hasSizeAttribute) {
        product.attributes.push({
          key: "Size",
          values: SIZES,
        });
      }

      product.variants = SIZES.map((size) => ({
        patternNumber: "",
        attributes: [
          {
            key: "Size",
            value: size,
          },
        ],
        sku: `${baseSku}-${size}`,
        barcode: "",
        stock: 0,
        reservedStock: 0,
        isInStock: false,
        weight: product.weight || 0,
      }));

      product.productType = "variable";
      product.stock = 0;
      product.isInStock = false;

      await product.save();

      updated++;
      console.log(`✅ ${product.productCode} - ${product.title}`);
    }

    console.log(`\n🎉 Done. Updated ${updated} products.`);
  } catch (error) {
    console.error("❌ Script failed:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Mongo disconnected");
  }
}

run();