import Order from "./Orders.js";

const str = (v) => (v == null ? "" : String(v));

const normalizePhone = (v = "") => str(v).replace(/\D/g, "").slice(-10);
const normalizePincode = (v = "") => str(v).trim();

const normalizeItems = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((i) => `${str(i?.productId)}:${Number(i?.quantity || 0)}`)
    .sort()
    .join("|");

const buildDuplicateKey = (order) => {
  const phone = normalizePhone(order?.shippingAddressSnapshot?.phone);
  const pincode = normalizePincode(order?.shippingAddressSnapshot?.pincode);
  const itemsKey = normalizeItems(order?.items);

  return `${phone}__${pincode}__${itemsKey}`;
};

export const detectDuplicateOrders = async () => {
  const orders = await Order.find({
    fulfillmentStatus: "processing",
  })
    .select(
      "_id orderNumber shippingAddressSnapshot items paymentMethod fulfillmentStatus createdAt adminRemarks"
    )
    .sort({ createdAt: -1 })
    .lean();

  const buckets = new Map();

  for (const order of orders) {
    const key = buildDuplicateKey(order);

    // invalid / weak key skip
    const [phone, pincode, itemsKey] = key.split("__");
    if (!phone || !pincode || !itemsKey) continue;

    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(order);
  }

  const duplicateGroups = [];

  for (const [, group] of buckets.entries()) {
    if (group.length <= 1) continue;

    duplicateGroups.push({
      count: group.length,
      reasons: ["same_phone", "same_pincode", "same_items"],
      orders: group.map((o) => ({
        _id: o._id,
        orderNumber: o.orderNumber,
        phone: o?.shippingAddressSnapshot?.phone || "",
        pincode: o?.shippingAddressSnapshot?.pincode || "",
        paymentMethod: o?.paymentMethod || "",
        fulfillmentStatus: o?.fulfillmentStatus || "",
        createdAt: o?.createdAt || null,
      })),
    });
  }

  return {
    ok: true,
    totalProcessingOrders: orders.length,
    duplicateGroupCount: duplicateGroups.length,
    duplicateGroups,
  };
};

export const markDuplicateOrderAlerts = async () => {
  const result = await detectDuplicateOrders();

  for (const group of result.duplicateGroups) {
    const orderNumbers = group.orders.map((o) => o.orderNumber);

    for (const order of group.orders) {
      const others = orderNumbers.filter((n) => n !== order.orderNumber).join(", ");

      await Order.findByIdAndUpdate(order._id, {
        $set: {
          adminRemarks: `🚨 Possible duplicate with ${others}`,
        },
      });
    }
  }

  return result;
};