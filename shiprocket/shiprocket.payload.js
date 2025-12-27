
export function buildShiprocketPayload(order) {
  const shipping = order.shippingAddressSnapshot;

  return {
    order_id: order.orderNumber,
    order_date: new Date().toISOString(),

    billing_customer_name: shipping.fullName,
    billing_last_name: "",
    billing_address: shipping.line1,
    billing_address_2: shipping.line2 || "",
    billing_city: shipping.city,
    billing_state: shipping.state,
    billing_pincode: shipping.pincode,
    billing_country: shipping.country || "India",
    billing_email: shipping.email,
    billing_phone: shipping.phone,

    shipping_is_billing: true,

    order_items: order.items.map((it) => ({
      name: it.productSnapshot.title,
      sku: it.variant?.sku || it.productSnapshot.sku || it.productId.toString(),
      units: it.quantity,
      selling_price: it.price,
    })),

    payment_method: order.paymentMethod === "cod" ? "COD" : "Prepaid",

    sub_total: order.subtotal,

    length: 10,
    breadth: 10,
    height: 5,
    weight:
      order.items.reduce(
        (sum, it) =>
          sum +
          (Number(it.variant?.weight || it.productSnapshot?.weight || 0.5) *
            it.quantity),
        0
      ) || 0.5,
  };
}
