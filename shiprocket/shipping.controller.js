import Order from "../Orders/Orders.js";
import { checkServiceability, createShipment } from "./index.js";
import { buildShiprocketPayload } from "./shiprocket.payload.js";
import { buildReverseShiprocketPayload } from "./shiprocket.reverse.payload.js";

/**
 * POST /api/orders/:id/ship
 * Book forward shipment with Shiprocket
 */
export async function bookWithShiprocket(req, res) {
  try {
    const orderId = req.params.id;

    /* ------------------------------------------------
       1️⃣ FETCH ORDER
    ------------------------------------------------ */
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    /* ------------------------------------------------
       2️⃣ VALIDATIONS
    ------------------------------------------------ */

    // Allow shipping only once
    if (order.shipment?.shiprocket?.awb) {
      return res.status(400).json({
        success: false,
        message: "Shipment already created for this order",
      });
    }

    // Status check
    if (order.fulfillmentStatus !== "processing") {
      return res.status(400).json({
        success: false,
        message: "Only processing orders can be shipped",
      });
    }

    // Payment guard
    if (
      order.paymentMethod === "razorpay" &&
      order.paymentStatus !== "paid"
    ) {
      return res.status(400).json({
        success: false,
        message: "Prepaid order must be paid before shipping",
      });
    }

    if (!order.shippingAddressSnapshot?.pincode) {
      return res.status(400).json({
        success: false,
        message: "Shipping address pincode missing",
      });
    }

    /* ------------------------------------------------
       3️⃣ COMPUTE TOTAL WEIGHT
    ------------------------------------------------ */
    const totalWeight =
      order.items.reduce((sum, it) => {
        const itemWeight =
          Number(it.variant?.weight) ||
          Number(it.productSnapshot?.weight) ||
          0.5;
        return sum + itemWeight * Number(it.quantity || 1);
      }, 0) || 0.5;

    /* ------------------------------------------------
       4️⃣ SERVICEABILITY CHECK
    ------------------------------------------------ */
    const couriers = await checkServiceability({
      pickupPincode: process.env.SHIPROCKET_PICKUP_PINCODE,
      deliveryPincode: order.shippingAddressSnapshot.pincode,
      weight: totalWeight,
      cod: order.paymentMethod === "cod",
    });

    if (!Array.isArray(couriers) || couriers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No courier available for this pincode",
      });
    }

    /* ------------------------------------------------
       5️⃣ CREATE SHIPMENT
    ------------------------------------------------ */
    const payload = buildShiprocketPayload(order);
    const shipment = await createShipment(payload);

    const awb = shipment?.awb_code || "";
    const courierName = shipment?.courier_name || "";
    const trackingUrl = shipment?.tracking_url || "";

    if (!awb) {
      throw new Error("Shiprocket did not return AWB");
    }

    /* ------------------------------------------------
       6️⃣ SAVE SHIPMENT DETAILS
    ------------------------------------------------ */
    order.shipment = {
      provider: "shiprocket",

      shiprocket: {
        shipmentId: String(shipment.shipment_id || ""),
        awb,
        courierName,
        trackingUrl,
      },

      status: "shipped",
      shippedAt: new Date(),
    };

    order.fulfillmentStatus = "shipped";

    // Preserve existing tracking fields if any
    order.trackingDetails = {
      ...(order.trackingDetails || {}),
      trackingId: awb,
      courierName,
      shippedAt: new Date(),
    };

    await order.save();

    /* ------------------------------------------------
       7️⃣ RESPONSE
    ------------------------------------------------ */
    return res.status(200).json({
      success: true,
      message: "Shipment booked successfully",
      shipment: {
        shipment_id: shipment.shipment_id,
        awb,
        courier: courierName,
        tracking_url: trackingUrl,
      },
    });
  } catch (err) {
    console.error(
      "❌ Shiprocket booking failed:",
      err?.response?.data || err
    );

    return res.status(500).json({
      success: false,
      message: "Shiprocket booking failed",
      error: err?.response?.data || err.message,
    });
  }
}

export async function createReversePickup(req, res) {
  try {
    const { orderId, rmaNumber } = req.params;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const rma = order.rmas.find(
      (r) => String(r.rmaNumber) === String(rmaNumber)
    );

    if (!rma) {
      return res.status(404).json({ message: "RMA not found" });
    }

    // Guards
    if (rma.status !== "approved") {
      return res.status(400).json({
        message: "RMA must be approved before pickup",
      });
    }

    if (rma.reverseShipment?.awb) {
      return res.status(400).json({
        message: "Reverse pickup already created",
      });
    }

    /* ------------------------------------------------
       CREATE REVERSE SHIPMENT
    ------------------------------------------------ */
    const payload = buildReverseShiprocketPayload({ order, rma });
    const shipment = await createShipment(payload);

    rma.reverseShipment = {
      provider: "shiprocket",
      orderId: shipment.order_id,
      shipmentId: shipment.shipment_id,
      awb: shipment.awb_code,
      courierName: shipment.courier_name,
      trackingUrl: shipment.tracking_url,
      pickupScheduledAt: new Date(),
    };

    rma.status = "pickup_scheduled";
    await order.save();

    return res.json({
      success: true,
      message: "Reverse pickup scheduled",
      reverseShipment: rma.reverseShipment,
    });
  } catch (error) {
    console.error("❌ Reverse Pickup Error:", error);
    return res.status(500).json({
      message: "Reverse pickup failed",
      error: error.message,
    });
  }
}