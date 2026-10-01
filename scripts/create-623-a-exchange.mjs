import "dotenv/config";
import dns from "node:dns";
import mongoose from "mongoose";
import Order from "../Orders/Orders.js";
import { createExchangeOrderFromRmaInternal } from "../Orders/orderController.js";

dns.setServers(["1.1.1.1", "1.0.0.1"]);
dns.promises.setServers(["1.1.1.1", "1.0.0.1"]);

try {
  await mongoose.connect(process.env.MONGO_URI);

  const order = await Order.findOne({ orderNumber: "000623-A" });
  if (!order) throw new Error("Order 000623-A not found");

  const rma = order.rmas.find(r => r.rmaNumber === "RMA-939198-42");
  if (!rma) throw new Error("Existing RMA not found");
  if (rma.items.length !== 1 || rma.items[0].productCode !== "00023") {
    throw new Error("RMA product does not match 00023");
  }

  if (await Order.exists({ orderNumber: "000623-A-E" })) {
    throw new Error("Exchange order 000623-A-E already exists");
  }

  rma.type = "exchange";
  rma.exchangeRequest = {
    productId: rma.items[0].productId,
    attributes: [{ key: "Size", value: "XS" }],
    note: "Size exchange S to XS"
  };
  order.markModified("rmas");
  await order.save();

  const exchange = await createExchangeOrderFromRmaInternal({
    orderId: order._id,
    rmaNumber: rma.rmaNumber,
    adminId: "admin"
  });

  console.log("CREATED:", exchange.orderNumber);
  console.log(exchange.items.map(item => ({
    code: item.productSnapshot.productCode,
    size: item.selectedSize,
    quantity: item.quantity
  })));
} catch (error) {
  console.error("FAILED:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
