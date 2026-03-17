import mongoose from "mongoose";
import Order from "../Orders/Orders.js";
import { reserveInventoryForOrderNumberInternal } from "../InventoryReservation/inventoryWebhook.js";

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

export const reserveInventoryForOrder = async ({
  orderId,
  debug = false,
  confirmedOnly = true,
  allowedFulfillment = ["processing", "packed"],
} = {}) => {
  if (!isObjectId(orderId)) throw new Error("Invalid orderId");

  const session = await mongoose.startSession();

  try {
    let summary = null;

    await session.withTransaction(async () => {
      const order = await Order.findById(orderId)
        .select("orderNumber")
        .session(session);

      if (!order) throw new Error("Order not found");

      summary = await reserveInventoryForOrderNumberInternal({
        orderNumber: order.orderNumber,
        confirmedOnly,
        allowedFulfillment,
        debug,
        session,
      });
    });

    return summary;
  } finally {
    session.endSession();
  }
};

export default reserveInventoryForOrder;