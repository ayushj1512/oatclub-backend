export function buildReverseShiprocketPayload({ order, rma }) {
  const addr = order.shippingAddressSnapshot;

  return {
    order_id: rma.rmaNumber,
    order_date: new Date().toISOString(),

    pickup_customer_name: addr.fullName,
    pickup_address: addr.line1,
    pickup_address_2: addr.line2 || "",
    pickup_city: addr.city,
    pickup_state: addr.state,
    pickup_country: addr.country || "India",
    pickup_pincode: addr.pincode,
    pickup_email: addr.email,
    pickup_phone: addr.phone,

    shipping_customer_name: process.env.RETURN_WAREHOUSE_NAME,
    shipping_address: process.env.RETURN_WAREHOUSE_ADDRESS,
    shipping_city: process.env.RETURN_WAREHOUSE_CITY,
    shipping_state: process.env.RETURN_WAREHOUSE_STATE,
    shipping_country: "India",
    shipping_pincode: process.env.RETURN_WAREHOUSE_PINCODE,
    shipping_phone: process.env.RETURN_WAREHOUSE_PHONE,

    order_items: rma.items.map((it) => ({
      name: it.title,
      sku: it.variantSku || it.productCode,
      units: it.quantity,
      selling_price: 0, // reverse pickup
    })),

    payment_method: "Prepaid",
    sub_total: 0,

    length: 10,
    breadth: 10,
    height: 5,
    weight: Math.max(0.5, calculateReverseWeight(order, rma)),
  };
}

function calculateReverseWeight(order, rma) {
  let total = 0;

  for (const ri of rma.items) {
    const item = order.items[ri.orderItemIndex];
    const w =
      item.variant?.weight ||
      item.productSnapshot?.weight ||
      0.5;

    total += w * ri.quantity;
  }

  return total;
}
