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
       0️⃣ ENV CHECKS (prevent silent failures)
    ------------------------------------------------ */
    if (!process.env.SHIPROCKET_PICKUP_PINCODE) {
      return res.status(500).json({
        success: false,
        message: "SHIPROCKET_PICKUP_PINCODE not configured in env",
      });
    }

    if (!process.env.SHIPROCKET_PICKUP_LOCATION) {
      return res.status(500).json({
        success: false,
        message: "SHIPROCKET_PICKUP_LOCATION not configured in env",
      });
    }

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
    if (order.shipment?.shiprocket?.awb) {
      return res.status(400).json({
        success: false,
        message: "Shipment already created for this order",
      });
    }

    if (order.fulfillmentStatus !== "processing") {
      return res.status(400).json({
        success: false,
        message: "Only processing orders can be shipped",
      });
    }

    if (order.paymentMethod === "razorpay" && order.paymentStatus !== "paid") {
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

    if (!Array.isArray(order.items) || order.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Order has no items to ship",
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

        const qty = Number(it.quantity || 1);
        return sum + itemWeight * qty;
      }, 0) || 0.5;

    /* ------------------------------------------------
       4️⃣ SERVICEABILITY CHECK
    ------------------------------------------------ */
    const deliveryPincode = String(order.shippingAddressSnapshot.pincode).trim();
    const pickupPincode = String(process.env.SHIPROCKET_PICKUP_PINCODE).trim();
    const isCod = order.paymentMethod === "cod";

    console.log("🚚 Shiprocket Serviceability Params:", {
      pickupPincode,
      deliveryPincode,
      totalWeight,
      isCod,
    });

    const couriers = await checkServiceability({
      pickupPincode,
      deliveryPincode,
      weight: totalWeight,
      cod: isCod,
    });

    console.log(
      "✅ Available Couriers Count:",
      Array.isArray(couriers) ? couriers.length : 0
    );

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

    // 🔍 Debug payload (VERY IMPORTANT)
    console.log("📦 Shiprocket Forward Payload:", JSON.stringify(payload, null, 2));

    const shipment = await createShipment(payload);

    // 🔍 Debug response (VERY IMPORTANT)
    console.log("✅ Shiprocket Forward Response:", JSON.stringify(shipment, null, 2));

    const awb = shipment?.awb_code || "";
    const courierName = shipment?.courier_name || "";
    const trackingUrl = shipment?.tracking_url || "";

    if (!awb) {
      throw new Error(
        shipment?.message ||
          shipment?.error ||
          "Shiprocket did not return AWB (courier assignment failed)"
      );
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
        status: "shipped",
        lastUpdatedAt: new Date(),
      },

      status: "shipped",
      shippedAt: new Date(),
    };

    order.fulfillmentStatus = "shipped";

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
    const shiprocketError = err?.response?.data || null;

    console.error("❌ Shiprocket booking failed:", shiprocketError || err.message);

    return res.status(500).json({
      success: false,
      message: "Shiprocket booking failed",
      error: shiprocketError || err.message,
    });
  }
}

/**
 * POST /api/shiprocket/reverse/:orderId/:rmaNumber
 * Schedule reverse pickup
 */
export async function createReversePickup(req, res) {
  try {
    const { orderId, rmaNumber } = req.params;

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

    const rma = order.rmas?.find(
      (r) => String(r.rmaNumber) === String(rmaNumber)
    );

    if (!rma) {
      return res.status(404).json({
        success: false,
        message: "RMA not found",
      });
    }

    /* ------------------------------------------------
       2️⃣ GUARDS
    ------------------------------------------------ */
    if (rma.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: "RMA must be approved before pickup",
      });
    }

    if (rma.reverseShipment?.awb) {
      return res.status(400).json({
        success: false,
        message: "Reverse pickup already created",
      });
    }

    /* ------------------------------------------------
       3️⃣ CREATE REVERSE SHIPMENT
    ------------------------------------------------ */
    const payload = buildReverseShiprocketPayload({ order, rma });

    console.log("📦 Shiprocket Reverse Payload:", JSON.stringify(payload, null, 2));

    const shipment = await createShipment(payload);

    console.log("✅ Shiprocket Reverse Response:", JSON.stringify(shipment, null, 2));

    const reverseAwb = shipment?.awb_code || "";

    if (!reverseAwb) {
      throw new Error(
        shipment?.message ||
          shipment?.error ||
          "Shiprocket did not return reverse AWB (reverse booking failed)"
      );
    }

    rma.reverseShipment = {
      provider: "shiprocket",
      orderId: shipment.order_id,
      shipmentId: shipment.shipment_id,
      awb: reverseAwb,
      courierName: shipment.courier_name,
      trackingUrl: shipment.tracking_url,
      pickupScheduledAt: new Date(),
      status: "pickup_scheduled",
      lastUpdatedAt: new Date(),
    };

    rma.status = "pickup_scheduled";
    await order.save();

    return res.status(200).json({
      success: true,
      message: "Reverse pickup scheduled",
      reverseShipment: rma.reverseShipment,
    });
  } catch (error) {
    const shiprocketError = error?.response?.data || null;

    console.error("❌ Reverse Pickup Error:", shiprocketError || error.message);

    return res.status(500).json({
      success: false,
      message: "Reverse pickup failed",
      error: shiprocketError || error.message,
    });
  }
}
