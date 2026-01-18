  export function buildShiprocketPayload(order) {
    const shipping = order.shippingAddressSnapshot;

    const orderSubtotal = Number(order.subtotal || 0);   // your computedSubtotal (pre discount)
    const orderDiscount = Number(order.discount || 0);   // total discount (coupon + etc)
    let remaining = orderDiscount;

    const order_items = (order.items || []).map((it, idx) => {
      const qty = Number(it.quantity || 1);

      // ✅ MRP per unit (prefer compareAtPrice, else price)
      const mrpUnit = Number(it.compareAtPrice || it.productId?.compareAtPrice || it.price || 0);

      // line subtotal from your order math (price * qty)
      const lineSubtotal = Number(it.subtotal || (Number(it.price || 0) * qty) || 0);

      // ✅ allocate order discount proportionally (total discount for this line)
      let lineDiscount = 0;
      if (orderSubtotal > 0 && orderDiscount > 0) {
        const raw = (orderDiscount * lineSubtotal) / orderSubtotal;
        lineDiscount = Math.round(raw);

        if (idx === (order.items.length - 1)) lineDiscount = remaining; // remainder adjust
        remaining -= lineDiscount;
      }

      const discountUnit = Math.round(lineDiscount / qty);

      return {
        name: it.productSnapshot?.title || it.productId?.title || "Item",
        sku: it.variant?.sku || it.productSnapshot?.sku || String(it.productId),
        units: qty,

        // ✅ MRP goes here
        selling_price: String(mrpUnit),

        // ✅ discount per unit goes here
        discount: String(discountUnit),

        // ✅ HSN code goes here
        hsn: String(it.productSnapshot?.hsnCode || it.productId?.hsnCode || "62105000"),
      };
    });

    // ✅ totals must match items (MRP model)
    const sub_total = order_items.reduce((s, x) => s + Number(x.selling_price) * Number(x.units), 0);
    const total_discount = order_items.reduce((s, x) => s + Number(x.discount) * Number(x.units), 0);

    return {
      order_id: order.orderNumber,
      order_date: new Date().toISOString(),

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
      billing_phone: shipping.phone,

      shipping_is_billing: true,

      order_items,

      payment_method: order.paymentMethod === "cod" ? "COD" : "Prepaid",

      // ✅ IMPORTANT: use computed MRP subtotal
      sub_total,

      // ✅ OPTIONAL but good if you send it elsewhere
      total_discount,

      length: 10,
      breadth: 10,
      height: 5,
      weight:
        order.items.reduce(
          (sum, it) =>
            sum + (Number(it.variant?.weight || it.productSnapshot?.weight || 0.5) * Number(it.quantity || 1)),
          0
        ) || 0.5,
    };
  }
