import { DELHIVERY_CONFIG } from "./config.js";

// Convert internal order into Delhivery format
export const buildShipmentPayload = (order) => ({
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
      payment_mode: order.paymentMode === "COD" ? "COD" : "Prepaid",

      cod_amount:
        order.paymentMode === "COD" ? Number(order.totalAmount) : 0,

      total_amount: Number(order.totalAmount),
      products_desc: order.productDescription || "Clothing",
      quantity: Number(order.quantity || 1),

      weight: Number(order.weight || 500),
      shipment_width: Number(order.width || 20),
      shipment_height: Number(order.height || 5),
      shipment_length: Number(order.length || 25),
    },
  ],
});
