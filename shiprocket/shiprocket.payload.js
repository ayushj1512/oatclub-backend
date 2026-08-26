export function buildShiprocketPayload(order) {
  const shipping = order.shippingAddressSnapshot || {};

  const subtotal = Math.max(
    0,
    Number(order.subtotal || 0),
  );

  const discount = Math.max(
    0,
    Number(order.discount || 0),
  );

  const paymentMethod = String(
    order.paymentMethod || "",
  )
    .trim()
    .toLowerCase();

  const isPartialCOD =
    paymentMethod === "partial_cod";

  const isComplimentary =
    paymentMethod === "complimentary";

  const isCOD =
    !isComplimentary &&
    ["cod", "partial_cod"].includes(paymentMethod);

  /* ============================================================
     ORDER ITEMS
  ============================================================ */

  let remainingDiscount = Math.round(discount);

  const order_items = (order.items || []).map(
    (it, idx) => {
      const qty = Math.max(
        1,
        Number(it.quantity || 1),
      );

      const lineSubtotal = Math.max(
        0,
        Number(
          it.subtotal ||
          Number(it.price || 0) * qty ||
          0,
        ),
      );

      let lineDiscount = 0;

      if (subtotal > 0 && discount > 0) {
        lineDiscount =
          idx === order.items.length - 1
            ? remainingDiscount
            : Math.round(
              (discount * lineSubtotal) /
              subtotal,
            );

        remainingDiscount -= lineDiscount;
      }

      const netLine = Math.max(
        0,
        lineSubtotal - lineDiscount,
      );

      const netUnit = Number(
        (netLine / qty).toFixed(2),
      );

      return {
        name:
          it.productSnapshot?.title ||
          it.productId?.title ||
          "Item",

        sku:
          it.variant?.sku ||
          it.productSnapshot?.sku ||
          String(it.productId),

        units: qty,

        // Actual merchandise value
        selling_price: String(netUnit),

        // IMPORTANT:
        // Partial COD advance is NOT sent as Shiprocket discount.
        discount: "0",

        hsn: String(
          it.productSnapshot?.hsnCode ||
          it.productId?.hsnCode ||
          "62105000",
        ),
      };
    },
  );

  /* ============================================================
     NORMAL SUBTOTAL
  ============================================================ */

  const normalSubTotal = order_items.reduce(
    (sum, item) =>
      sum +
      Number(item.selling_price || 0) *
      Math.max(1, Number(item.units || 1)),
    0,
  );

  /* ============================================================
     PARTIAL COD

     Example:
     Order value      ₹899
     Paid online       ₹90
     Shiprocket COD   ₹809

     Shiprocket must receive ₹809 as sub_total.
  ============================================================ */

  const remainingCodAmount = isPartialCOD
    ? Math.max(
      0,
      Number(
        order?.partialPayment
          ?.remainingCodAmount ??
        order?.paymentBreakdown?.codAmount ??
        0,
      ),
    )
    : 0;

  const shiprocketSubTotal = isPartialCOD
    ? remainingCodAmount
    : normalSubTotal;

  return {
    order_id: order.orderNumber,

    order_date: (
      order.orderDate
        ? new Date(order.orderDate)
        : new Date()
    ).toISOString(),

    pickup_location:
      process.env.SHIPROCKET_PICKUP_LOCATION,

    billing_customer_name:
      shipping.fullName,

    billing_last_name:
      shipping.fullName
        ?.split(" ")
        .slice(1)
        .join(" ") || "NA",

    billing_address:
      shipping.line1,

    billing_address_2:
      shipping.line2 || "",

    billing_city:
      shipping.city,

    billing_state:
      shipping.state,

    billing_pincode:
      shipping.pincode,

    billing_country:
      shipping.country || "India",

    billing_email:
      shipping.email,

    billing_phone: String(
      shipping.phone || "",
    ).replace(/\D/g, ""),

    shipping_is_billing: true,

    order_items,

    payment_method:
      isComplimentary
        ? "Prepaid"
        : isCOD
          ? "COD"
          : "Prepaid",

    // ✅ THIS controls Shiprocket COD amount
    sub_total: shiprocketSubTotal,

    length: 10,
    breadth: 10,
    height: 5,
    weight: 0.5,
  };
}
