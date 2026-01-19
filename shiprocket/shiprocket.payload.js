export function buildShiprocketPayload(order) {
  const shipping = order.shippingAddressSnapshot;

  const orderSubtotal = Number(order.subtotal || 0);   // pre-discount subtotal (sum of item subtotals)
  const orderDiscount = Number(order.discount || 0);   // total discount (coupon + razorpay etc)
  let remaining = Math.round(orderDiscount);

  const order_items = (order.items || []).map((it, idx) => {
    const qty = Math.max(1, Number(it.quantity || 1));
    const lineSubtotal = Number(it.subtotal || (Number(it.price || 0) * qty) || 0);

    // allocate discount proportionally (line level)
    let lineDiscount = 0;
    if (orderSubtotal > 0 && orderDiscount > 0) {
      const raw = (orderDiscount * lineSubtotal) / orderSubtotal;
      lineDiscount = Math.round(raw);

      if (idx === (order.items.length - 1)) lineDiscount = remaining; // remainder fix
      remaining -= lineDiscount;
    }

    const netLine = Math.max(0, lineSubtotal - lineDiscount);
    const netUnit = Math.round(netLine / qty); // per-unit net

    return {
      name: it.productSnapshot?.title || it.productId?.title || "Item",
      sku: it.variant?.sku || it.productSnapshot?.sku || String(it.productId),
      units: qty,

      // ✅ NET per-unit price (Shiprocket selling_price)
      selling_price: String(netUnit),

      // ✅ no discount field usage
      discount: "0",

      hsn: String(it.productSnapshot?.hsnCode || it.productId?.hsnCode || "62105000"),
    };
  });

  const sub_total = order_items.reduce(
    (s, x) => s + Number(x.selling_price) * Number(x.units),
    0
  );

  return {
    order_id: order.orderNumber,
    // ✅ use actual orderDate (not "now")
    order_date: (order.orderDate ? new Date(order.orderDate) : new Date()).toISOString(),

    pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION,

    billing_customer_name: shipping.fullName,
    billing_last_name: shipping.fullName?.split(" ").slice(1).join(" ") || "NA",
    billing_address: shipping.line1,
    billing_address_2: shipping.line2 || "",
    billing_city: shipping.city,
    billing_state: shipping.state,
    billing_pincode: shipping.pincode,
    billing_country: shipping.country || "India",
    billing_email: shipping.email,
    billing_phone: String(shipping.phone || "").replace(/[^\d]/g, ""), // ✅ just digits

    shipping_is_billing: true,
    order_items,

    // ✅ Shiprocket wants COD/Prepaid (you already override later too)
    payment_method: order.paymentMethod === "cod" ? "COD" : "Prepaid",

    // ✅ NET subtotal
    sub_total,

    length: 10,
    breadth: 10,
    height: 5,

    weight:
      order.items.reduce((sum, it) => {
        const w = Number(it.variant?.weight) || Number(it.productSnapshot?.weight) || 0.5;
        return sum + (w * Number(it.quantity || 1));
      }, 0) || 0.5,
  };
}
