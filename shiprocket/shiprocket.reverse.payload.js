export function buildReverseShiprocketPayload({ order, rma }) {
  const addr = order.shippingAddressSnapshot || {};

  return {
    order_id: `R_${String(order.orderNumber || "")
      .replace(/^#/, "")
      .trim()}`,
    order_date: new Date().toISOString().slice(0, 10),

    // Customer → Pickup
    pickup_customer_name: addr.fullName || "Customer",
    pickup_last_name: "",
    pickup_address: addr.line1 || "",
    pickup_address_2: addr.line2 || "",
    pickup_city: addr.city || "",
    pickup_state: addr.state || "",
    pickup_country: addr.country || "India",
    pickup_pincode: Number(addr.pincode),
    pickup_email: addr.email || "",
    pickup_phone: String(addr.phone || "").replace(/\D/g, "").slice(-10),
    pickup_isd_code: "91",

    // OATCLUB Warehouse → Return Destination
    shipping_customer_name: "OATCLUB",
    shipping_last_name: "",
    shipping_address:
      "House No. 1033, 2nd Floor, Gali No. 15, Lakhapat Colony Part 2, Meethapur Extension",
    shipping_address_2: "Badarpur, South Delhi",
    shipping_city: "Delhi",
    shipping_state: "Delhi",
    shipping_country: "India",
    shipping_pincode: 110044,
    shipping_phone: 7217649990,
    shipping_email: "",
    shipping_isd_code: "91",

    // RMA Items
    order_items: (rma.items || []).map((ri) => {
      const item = order.items?.[ri.orderItemIndex] || {};

      return {
        name:
          ri.title ||
          item.title ||
          item.productSnapshot?.title ||
          "Product",

        sku:
          ri.variantSku ||
          item.variant?.sku ||
          ri.productCode ||
          item.productSnapshot?.productCode ||
          "",

        units: Number(ri.quantity || 1),
        selling_price: Number(item.price || item.sellingPrice || 0),
        discount: 0,
      };
    }),

    payment_method: "PREPAID",
    total_discount: 0,
    sub_total: 0,

    // Package
    length: 10,
    breadth: 10,
    height: 5,
    weight: Math.max(0.5, calculateReverseWeight(order, rma)),
  };
}

function calculateReverseWeight(order, rma) {
  return (rma.items || []).reduce((total, ri) => {
    const item = order.items?.[ri.orderItemIndex] || {};

    const weight =
      Number(item.variant?.weight) ||
      Number(item.productSnapshot?.weight) ||
      0.5;

    return total + weight * Number(ri.quantity || 1);
  }, 0);
}
