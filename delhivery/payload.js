import { DELHIVERY_CONFIG } from "./config.js";

// Convert internal order into Delhivery format
export const buildShipmentPayload = (order) => {
  const paymentMethod = String(
    order.paymentMethod || order.paymentMode || ""
  ).toLowerCase();

  const isCod = paymentMethod === "cod";
  const isPartialCod = paymentMethod === "partial_cod";

  const totalAmount = Number(
    order.finalPayable ?? order.totalAmount ?? 0
  );

  const codAmount = isPartialCod
    ? Number(order.partialPayment?.remainingCodAmount || 0)
    : isCod
      ? totalAmount
      : 0;

  if (
    isPartialCod &&
    (
      order.paymentStatus !== "partially_paid" ||
      order.partialPayment?.upfrontPaid !== true
    )
  ) {
    throw new Error(
      "Partial COD upfront payment is not completed."
    );
  }

  if ((isCod || isPartialCod) && codAmount <= 0) {
    throw new Error("Valid COD collection amount is required.");
  }

  return {
    pickup_location: {
      name: DELHIVERY_CONFIG.pickupLocation,
    },

    shipments: [
      {
        name: order.customerName,
        add: order.address,
        pin: String(order.pincode),
        city: order.city,
        state: order.state,
        country: "India",
        phone: String(order.phone),
        order: String(order.orderNumber),

        payment_mode:
          isCod || isPartialCod ? "COD" : "Prepaid",

        cod_amount: codAmount,
        total_amount: totalAmount,

        products_desc:
          order.productDescription || "Clothing",

        quantity: Number(order.quantity || 1),
        weight: Number(order.weight || 500),
        shipment_width: Number(order.width || 20),
        shipment_height: Number(order.height || 5),
        shipment_length: Number(order.length || 25),
      },
    ],
  };
};
