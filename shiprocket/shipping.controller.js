import {
  checkServiceability,
  createShipment,
} from "./index.js";

export async function bookWithShiprocket(req, res) {
  const order = req.body;

  const couriers = await checkServiceability({
    pickupPincode: process.env.SHIPROCKET_PICKUP_PINCODE,
    deliveryPincode: order.shippingPincode,
    weight: order.weight,
    cod: order.paymentMethod === "COD",
  });

  if (!couriers.length) {
    return res.status(400).json({
      success: false,
      message: "Shiprocket not serviceable",
    });
  }

  const shipment = await createShipment({
    order_id: order.orderId,
    order_date: new Date(),
    billing_customer_name: order.name,
    billing_address: order.address,
    billing_pincode: order.shippingPincode,
    billing_phone: order.phone,
    payment_method: order.paymentMethod,
    order_items: order.items,
    weight: order.weight,
  });

  res.json({
    success: true,
    shipment_id: shipment.shipment_id,
    awb: shipment.awb_code,
    tracking_url: shipment.tracking_url,
  });
}
