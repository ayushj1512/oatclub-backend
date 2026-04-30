import Order from "./Orders.js";

export const updateOrderFulfillmentStatus = async ({
  orderId,
  status,
  session = null,
}) => {
  const query = Order.findById(orderId);
  if (session) query.session(session);

  const order = await query;
  if (!order) throw new Error("Order not found");

  order.fulfillmentStatus = status;

  await order.save(session ? { session } : undefined);
  return order;
};