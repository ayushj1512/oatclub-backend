import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

/* -------------------------------------------------------
   Minimal schemas (only fields needed for this script)
------------------------------------------------------- */
const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, index: true },
    items: [
      {
        productModel: {
          type: String,
          enum: ["Product", "Footwear"],
          default: "Product",
        },
        productId: mongoose.Schema.Types.ObjectId,
      },
    ],
  },
  { collection: "orders" }
);

const productSchema = new mongoose.Schema(
  {
    hsnCode: { type: String, default: "" },
  },
  { strict: false }
);

const Order =
  mongoose.models.Order || mongoose.model("Order", orderSchema);

const Product =
  mongoose.models.Product || mongoose.model("Product", productSchema, "products");

const Footwear =
  mongoose.models.Footwear ||
  mongoose.model("Footwear", productSchema, "footwear");

/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */
const isMissingHSN = (value) => {
  return value == null || String(value).trim() === "";
};

async function run() {
  if (!MONGO_URI) {
    throw new Error("MONGO_URI not found in .env");
  }

  await mongoose.connect(MONGO_URI);
  console.log("✅ MongoDB connected");

  const orders = await Order.find(
    {
      items: { $exists: true, $ne: [] },
    },
    {
      orderNumber: 1,
      items: 1,
    }
  ).lean();

  const affectedOrderNumbers = new Set();

  for (const order of orders) {
    if (!Array.isArray(order.items) || order.items.length === 0) continue;

    let orderHasMissingHSN = false;

    for (const item of order.items) {
      if (!item?.productId) continue;

      const modelName = item.productModel === "Footwear" ? "Footwear" : "Product";
      const Model = modelName === "Footwear" ? Footwear : Product;

      const product = await Model.findById(item.productId, { hsnCode: 1 }).lean();

      // product not found OR hsnCode missing => mark order
      if (!product || isMissingHSN(product.hsnCode)) {
        orderHasMissingHSN = true;
        break;
      }
    }

    if (orderHasMissingHSN && order.orderNumber) {
      affectedOrderNumbers.add(order.orderNumber);
    }
  }

  const result = [...affectedOrderNumbers].sort();

  console.log("\n==============================");
  console.log("Orders with missing product HSN");
  console.log("==============================\n");

  if (!result.length) {
    console.log("No orders found.");
  } else {
    result.forEach((orderNumber) => console.log(orderNumber));
    console.log(`\nTotal orders: ${result.length}`);
  }

  await mongoose.disconnect();
  console.log("\n✅ MongoDB disconnected");
}

run().catch(async (err) => {
  console.error("\n❌ Script failed:");
  console.error(err.message || err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});