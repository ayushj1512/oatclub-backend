import Order from "../Orders/Orders.js";
import { checkServiceability, createShipment } from "./index.js";
import { buildShiprocketPayload } from "./shiprocket.payload.js";
import { buildReverseShiprocketPayload } from "./shiprocket.reverse.payload.js";
import { getShiprocketToken } from "./shiprocket.auth.js";
import { shiprocketApi } from "./shiprocket.client.js";
import { generateShiprocketLabel } from "./shiprocket.label.js";
import { createReturnOrder } from "./shiprocket.return.js";

const s = (v) => (v == null ? "" : String(v)).trim();

const getShiprocketError = (err) =>
  err?.response?.data || err?.message || "Unknown Shiprocket error";

const stringifyError = (err) => {
  const raw = getShiprocketError(err);
  return typeof raw === "string"
    ? raw.toLowerCase()
    : JSON.stringify(raw || {}).toLowerCase();
};

const isShiprocketTemporaryError = (err) => {
  const status = err?.response?.status;
  const msg = stringifyError(err);

  return (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    msg.includes("upstream") ||
    msg.includes("connection") ||
    msg.includes("gateway") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout")
  );
};

const isShiprocketAuthError = (err) => {
  const status = err?.response?.status;
  const msg = stringifyError(err);

  return (
    status === 401 ||
    status === 403 ||
    msg.includes("token") ||
    msg.includes("unauthorized") ||
    msg.includes("authentication") ||
    msg.includes("unauthenticated")
  );
};

const sendShiprocketError = (res, err, fallbackMessage) => {
  const status = err?.response?.status;
  const error = getShiprocketError(err);

  if (isShiprocketAuthError(err)) {
    return res.status(401).json({
      success: false,
      code: "SHIPROCKET_AUTH_FAILED",
      message: "Shiprocket authentication failed. Please try again.",
      retryable: true,
      error,
    });
  }

  if (isShiprocketTemporaryError(err)) {
    return res.status(503).json({
      success: false,
      code: "SHIPROCKET_TEMPORARY_DOWN",
      message:
        "Shiprocket service is temporarily unavailable. Please try again later.",
      retryable: true,
      retryAfterSec: 120,
      error,
    });
  }

  return res.status(status || 500).json({
    success: false,
    message: fallbackMessage,
    error,
  });
};

export async function bookWithShiprocket(req, res) {
  try {
    const orderId = req.params.id;

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

    const order = await Order.findById(orderId);

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const shipmentStatus = s(order?.shipment?.status).toLowerCase();

    const existingAwb = s(
      order?.shipment?.awb ||
      order?.shipment?.shiprocket?.awb,
    );

    const inactiveShipmentStatuses = [
      "cancelled",
      "canceled",
      "failed",
      "void",
    ];

    const hasActiveShipment =
      Boolean(existingAwb) &&
      !inactiveShipmentStatuses.includes(shipmentStatus);

    if (hasActiveShipment) {
      return res.status(400).json({
        success: false,
        message:
          "An active shipment already exists. Cancel it before rebooking.",
      });
    }
    const fulfillmentStatus = s(
      order.fulfillmentStatus,
    ).toLowerCase();

    const allowedFulfillmentStatuses = [
      "processing",
      "packed",
    ];

    if (!allowedFulfillmentStatuses.includes(fulfillmentStatus)) {
      return res.status(400).json({
        success: false,
        message:
          "Only processing or packed orders can be booked with Shiprocket.",
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

    const totalWeight =
      order.items.reduce((sum, item) => {
        const itemWeight =
          Number(item.variant?.weight) ||
          Number(item.productSnapshot?.weight) ||
          0.5;

        return sum + itemWeight * Number(item.quantity || 1);
      }, 0) || 0.5;

    const deliveryPincode = s(order.shippingAddressSnapshot.pincode);
    const pickupPincode = s(process.env.SHIPROCKET_PICKUP_PINCODE);
    const isCod = order.paymentMethod === "cod";

    const couriers = await checkServiceability({
      pickupPincode,
      deliveryPincode,
      weight: totalWeight,
      cod: isCod,
    });

    if (!Array.isArray(couriers) || couriers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No courier available for this pincode",
      });
    }

    const payload = buildShiprocketPayload(order);
    const shipment = await createShipment(payload);

    const awb = s(shipment?.awb_code);
    const courierName = s(shipment?.courier_name);

    const shiprocketOrderId = s(shipment?.order_id);
    const shiprocketShipmentId = s(shipment?.shipment_id);

    const trackingUrl =
      s(shipment?.tracking_url) ||
      (awb ? `https://shiprocket.co/tracking/${encodeURIComponent(awb)}` : "");

    if (!awb) {
      throw new Error(
        shipment?.message ||
          shipment?.error ||
          "Shiprocket did not return AWB. Courier assignment failed.",
      );
    }

    const now = new Date();

    const existingShipment =
      order.shipment?.toObject?.() || order.shipment || {};

    const existingShiprocket =
      order.shipment?.shiprocket?.toObject?.() ||
      order.shipment?.shiprocket ||
      {};

    order.shipment = {
      ...existingShipment,

      provider: "shiprocket",

      orderId: shiprocketOrderId,
      shipmentId: shiprocketShipmentId,
      awb,
      courierName,
      trackingUrl,

      status: "shipped",
      shippedAt: now,
      lastSyncedAt: now,
      lastTrackAt: now,

      shiprocket: {
        ...existingShiprocket,

        orderId: shiprocketOrderId,
        shipmentId: shiprocketShipmentId,
        awb,
        courierName,
        trackingUrl,
      },
    };

    order.fulfillmentStatus = "shipped";

    order.trackingDetails = {
      ...(order.trackingDetails?.toObject?.() || order.trackingDetails || {}),

      trackingId: awb,
      awb,
      provider: "shiprocket",
      courierName,
      trackingUrl,
      shippedAt: now,
      lastUpdatedAt: now,
    };

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Shipment booked successfully",
      shipment: {
        order_id: shipment.order_id,
        shipment_id: shipment.shipment_id,
        awb,
        courier: courierName,
        tracking_url: trackingUrl,
      },
    });
  } catch (err) {
    console.error("❌ Shiprocket booking failed:", getShiprocketError(err));
    return sendShiprocketError(res, err, "Shiprocket booking failed");
  }
}


export async function createReversePickup(req, res) {
  try {
    const { orderId, rmaNumber } = req.params;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const rma = order.rmas?.find(
      (item) => String(item.rmaNumber) === String(rmaNumber),
    );

    if (!rma) {
      return res.status(404).json({
        success: false,
        message: "RMA not found",
      });
    }


    if (
      rma.reverseShipment?.orderId ||
      rma.reverseShipment?.shipmentId ||
      rma.reverseShipment?.awb
    ) {
      return res.status(400).json({
        success: false,
        message: "Reverse pickup already created",
      });
    }

    const payload = buildReverseShiprocketPayload({
      order,
      rma,
    });

    console.log("↩️ Creating Shiprocket return order:", {
      orderNumber: order.orderNumber,
      rmaNumber: rma.rmaNumber,
      items: payload.order_items.length,
    });

    const shipment = await createReturnOrder(payload);

    const reverseAwb = s(
      shipment?.awb_code ||
      shipment?.awb ||
      shipment?.shipment?.awb_code,
    );

    const shiprocketOrderId = s(
      shipment?.order_id ||
      shipment?.id,
    );

    const shiprocketShipmentId = s(
      shipment?.shipment_id ||
      shipment?.shipment?.id,
    );

    if (!shiprocketOrderId && !shiprocketShipmentId) {
      throw new Error(
        shipment?.message ||
        shipment?.error ||
        "Shiprocket return order creation failed.",
      );
    }

    const now = new Date();

    rma.reverseShipment = {
      provider: "shiprocket",

      orderId: shiprocketOrderId,
      shipmentId: shiprocketShipmentId,

      awb: reverseAwb,

      courierName: s(
        shipment?.courier_name ||
        shipment?.courier,
      ),

      trackingUrl: s(shipment?.tracking_url),

      pickupScheduledAt: reverseAwb ? now : null,

      status: reverseAwb
        ? "pickup_scheduled"
        : "return_order_created",

      lastUpdatedAt: now,
    };

    if (reverseAwb) {
      rma.status = "pickup_scheduled";
    }

    await order.save();

    return res.status(200).json({
      success: true,

      message: reverseAwb
        ? "Reverse pickup scheduled"
        : "Shiprocket return order created",

      reverseShipment: rma.reverseShipment,
    });
  } catch (err) {
    console.error(
      "❌ Reverse Pickup Error:",
      getShiprocketError(err),
    );

    return sendShiprocketError(
      res,
      err,
      "Reverse pickup failed",
    );
  }
}

export async function getShiprocketTokenApi(req, res) {
  try {
    const token = await getShiprocketToken();

    return res.status(200).json({
      success: true,
      token,
    });
  } catch (err) {
    console.error("❌ Shiprocket Token API Error:", getShiprocketError(err));
    return sendShiprocketError(res, err, "Shiprocket authentication failed");
  }
}

export async function syncShiprocketTrackingFlex(req, res) {
  try {
    const id = req.params?.id;
    const orderNumber = s(req.query?.orderNumber);

    let order = null;

    if (id) order = await Order.findById(id);
    else if (orderNumber) order = await Order.findOne({ orderNumber });
    else {
      return res.status(400).json({
        success: false,
        message: "Provide order id or orderNumber",
      });
    }

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const shipmentId = s(order?.shipment?.shiprocket?.shipmentId);
    const shiprocketOrderId = s(order?.shipment?.shiprocket?.orderId);

    if (!shipmentId && !shiprocketOrderId) {
      return res.status(400).json({
        success: false,
        message:
          "Shiprocket shipmentId/orderId missing in order. Cannot sync tracking.",
        orderId: String(order._id),
        orderNumber: order.orderNumber,
      });
    }

    const existingAwb = s(
      order?.shipment?.shiprocket?.awb || order?.trackingDetails?.trackingId,
    );
    const existingCourier = s(
      order?.shipment?.shiprocket?.courierName ||
        order?.trackingDetails?.courierName,
    );
    const existingUrl = s(
      order?.shipment?.shiprocket?.trackingUrl ||
        order?.shipment?.trackingUrl ||
        order?.trackingDetails?.trackingUrl,
    );

    const existingLabelUrl = s(
      order?.shipment?.shiprocket?.labelUrl || order?.shipment?.labelUrl,
    );

    let nextAwb = existingAwb;
    let nextCourier = existingCourier;
    let nextUrl = existingUrl;
    let nextLabelUrl = existingLabelUrl;

    let source = "";
    let rawTrack = null;
    let rawShow = null;
    let rawLabel = null;
    let trackFailed = false;
    let trackError = null;

    if (shipmentId) {
      try {
        rawTrack = await shiprocketApi({
          method: "GET",
          url: `/courier/track/shipment/${encodeURIComponent(shipmentId)}`,
          timeout: 20000,
        });

        const td = rawTrack?.tracking_data || {};
        const st = Array.isArray(td?.shipment_track)
          ? td.shipment_track[0] || {}
          : {};

        const awbFromTrack = s(st?.awb_code || td?.awb_code);
        const courierFromTrack = s(st?.courier_name || td?.courier_name);
        const urlFromTrack = s(st?.tracking_url || td?.tracking_url);

        if (awbFromTrack) nextAwb = awbFromTrack;
        if (courierFromTrack) nextCourier = courierFromTrack;
        if (urlFromTrack) nextUrl = urlFromTrack;

        source = "courier/track/shipment";
      } catch (err) {
        trackFailed = true;
        trackError = err;
        console.error(
          "❌ Shiprocket track/shipment failed:",
          getShiprocketError(err),
        );
      }
    } else {
      trackFailed = true;
    }

    const needMore = !nextAwb || !nextCourier;

    if ((trackFailed || needMore) && shiprocketOrderId) {
      try {
        rawShow = await shiprocketApi({
          method: "GET",
          url: `/orders/show/${encodeURIComponent(shiprocketOrderId)}`,
          timeout: 20000,
        });

        const awbFromShow = s(
          rawShow?.awb_code ||
            rawShow?.awb ||
            rawShow?.shipment?.awb_code ||
            rawShow?.shipment?.awb,
        );

        const courierFromShow = s(
          rawShow?.courier_name ||
            rawShow?.courier ||
            rawShow?.shipment?.courier_name ||
            rawShow?.shipment?.courier,
        );

        const urlFromShow = s(
          rawShow?.tracking_url || rawShow?.shipment?.tracking_url,
        );

        if (awbFromShow) nextAwb = awbFromShow;
        if (courierFromShow) nextCourier = courierFromShow;
        if (urlFromShow) nextUrl = urlFromShow;

        source = source ? `${source} + orders/show` : "orders/show";
      } catch (err) {
        console.error(
          "⚠️ Shiprocket orders/show fallback failed:",
          getShiprocketError(err),
        );

        if (
          !nextAwb &&
          !nextCourier &&
          !nextUrl &&
          isShiprocketTemporaryError(err)
        ) {
          return sendShiprocketError(
            res,
            err,
            "Shiprocket tracking sync failed",
          );
        }
      }
    }

    if (!nextUrl && nextAwb) {
      nextUrl = `https://shiprocket.co/tracking/${encodeURIComponent(nextAwb)}`;
    }

    if (!nextLabelUrl && shipmentId) {
      try {
        const labelResult = await generateShiprocketLabel(shipmentId);

        nextLabelUrl = s(labelResult?.labelUrl);
        rawLabel = labelResult?.raw || null;

        if (nextLabelUrl) {
          source = source ? `${source} + generate/label` : "generate/label";
        }
      } catch (err) {
        console.error(
          "⚠️ Shiprocket label generation failed:",
          getShiprocketError(err),
        );
      }
    }

    const gotAny = Boolean(nextAwb || nextCourier || nextUrl || nextLabelUrl);
    if (
      !gotAny &&
      trackFailed &&
      trackError &&
      isShiprocketTemporaryError(trackError)
    ) {
      return sendShiprocketError(
        res,
        trackError,
        "Shiprocket tracking sync failed",
      );
    }

    if (!gotAny) {
      return res.status(200).json({
        success: true,
        message:
          "Tracking not available yet. AWB/carrier may not be generated by Shiprocket.",
        source: source || "none",
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        shipmentId,
        shiprocketOrderId,
        trackingId: existingAwb,
        courierName: existingCourier,
        trackingUrl: existingUrl,
        labelUrl: existingLabelUrl,
        rawTrack,
        rawShow,
      });
    }

    const now = new Date();

    const $set = {
      "shipment.provider": "shiprocket",

      "shipment.lastSyncedAt": now,
      "shipment.lastTrackAt": now,
      "shipment.lastTrack": rawTrack || rawShow || null,

      "shipment.shiprocket.lastTrack": rawTrack || rawShow || null,

      "trackingDetails.provider": "shiprocket",
      "trackingDetails.lastUpdatedAt": now,
    };

    if (shiprocketOrderId) {
      $set["shipment.orderId"] = shiprocketOrderId;
      $set["shipment.shiprocket.orderId"] = shiprocketOrderId;
    }

    if (shipmentId) {
      $set["shipment.shipmentId"] = shipmentId;
      $set["shipment.shiprocket.shipmentId"] = shipmentId;
    }

    if (nextAwb) {
      $set["shipment.awb"] = nextAwb;
      $set["shipment.shiprocket.awb"] = nextAwb;

      $set["trackingDetails.trackingId"] = nextAwb;
      $set["trackingDetails.awb"] = nextAwb;
    }

    if (nextCourier) {
      $set["shipment.courierName"] = nextCourier;
      $set["shipment.shiprocket.courierName"] = nextCourier;

      $set["trackingDetails.courierName"] = nextCourier;
    }

    if (nextUrl) {
      $set["shipment.trackingUrl"] = nextUrl;
      $set["shipment.shiprocket.trackingUrl"] = nextUrl;

      $set["trackingDetails.trackingUrl"] = nextUrl;
    }

    if (nextLabelUrl) {
      $set["shipment.labelUrl"] = nextLabelUrl;
      $set["shipment.shiprocket.labelUrl"] = nextLabelUrl;
    }

    await Order.updateOne(
      { _id: order._id },
      { $set },
      { runValidators: true },
    );

    return res.status(200).json({
      success: true,
      message: "Tracking and label synced from Shiprocket",
      source: source || "shiprocket",
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      shipmentId,
      shiprocketOrderId,
      trackingId: nextAwb,
      courierName: nextCourier,
      trackingUrl: nextUrl,
      labelUrl: nextLabelUrl,
    });
  } catch (err) {
    console.error(
      "❌ Shiprocket Tracking Sync Error:",
      getShiprocketError(err),
    );
    return sendShiprocketError(res, err, "Shiprocket tracking sync failed");
  }
}

export async function checkShiprocketServiceabilityApi(req, res) {
  try {
    const {
      pickupPincode,
      deliveryPincode,
      weight = 0.5,
      cod = false,
    } = req.query;

    if (!pickupPincode || !deliveryPincode) {
      return res.status(400).json({
        success: false,
        message: "pickupPincode and deliveryPincode are required",
      });
    }

    const couriers = await checkServiceability({
      pickupPincode: s(pickupPincode),
      deliveryPincode: s(deliveryPincode),
      weight: Number(weight) || 0.5,
      cod: cod === true || cod === "true" || cod === "1" || cod === 1,
    });

    const cleaned = (couriers || []).map((courier) => ({
      courier_name: courier.courier_name,
      courier_company_id: courier.courier_company_id,
      freight_charge: courier.freight_charge,
      cod_charges: courier.cod_charges,
      etd: courier.etd,
      rating: courier.rating,
    }));

    return res.status(200).json({
      success: true,
      total: cleaned.length,
      couriers: cleaned,
    });
  } catch (err) {
    console.error("❌ Serviceability API Error:", getShiprocketError(err));
    return sendShiprocketError(res, err, "Failed to check serviceability");
  }
}
