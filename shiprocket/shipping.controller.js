import Order from "../Orders/Orders.js";
import { checkServiceability, createShipment } from "./index.js";
import { buildShiprocketPayload } from "./shiprocket.payload.js";
import { buildReverseShiprocketPayload } from "./shiprocket.reverse.payload.js";
import { getShiprocketToken } from "./shiprocket.auth.js";
import axios from "axios";

const SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external";

const s = (v) => (v == null ? "" : String(v)).trim();
const isNonEmpty = (v) => s(v).length > 0;

const getShiprocketError = (err) => {
  return err?.response?.data || err?.message || "Unknown Shiprocket error";
};

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
    msg.includes("no healthy upstream") ||
    msg.includes("upstream connect error") ||
    msg.includes("disconnect/reset before headers") ||
    msg.includes("remote connection failure") ||
    msg.includes("delayed connect error") ||
    msg.includes("connection failure") ||
    msg.includes("bad gateway") ||
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
      message: "Shiprocket authentication failed. Please refresh token and try again.",
      retryable: true,
      error,
    });
  }

  if (isShiprocketTemporaryError(err)) {
    return res.status(503).json({
      success: false,
      code: "SHIPROCKET_TEMPORARY_DOWN",
      message:
        "Shiprocket service is temporarily unavailable. Please try again after some time.",
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

/**
 * POST /api/orders/:id/ship
 * Book forward shipment with Shiprocket
 */
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
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

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

    const totalWeight =
      order.items.reduce((sum, item) => {
        const itemWeight =
          Number(item.variant?.weight) ||
          Number(item.productSnapshot?.weight) ||
          0.5;

        const qty = Number(item.quantity || 1);
        return sum + itemWeight * qty;
      }, 0) || 0.5;

    const deliveryPincode = s(order.shippingAddressSnapshot.pincode);
    const pickupPincode = s(process.env.SHIPROCKET_PICKUP_PINCODE);
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

    if (!Array.isArray(couriers) || couriers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No courier available for this pincode",
      });
    }

    const payload = buildShiprocketPayload(order);

    console.log("📦 Shiprocket Forward Payload:", JSON.stringify(payload, null, 2));

    const shipment = await createShipment(payload);

    console.log("✅ Shiprocket Forward Response:", JSON.stringify(shipment, null, 2));

    const awb = s(shipment?.awb_code);
    const courierName = s(shipment?.courier_name);
    const trackingUrl = s(shipment?.tracking_url);

    if (!awb) {
      throw new Error(
        shipment?.message ||
          shipment?.error ||
          "Shiprocket did not return AWB. Courier assignment failed."
      );
    }

    order.shipment = {
      provider: "shiprocket",
      shiprocket: {
        orderId: String(shipment.order_id || ""),
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
      trackingUrl,
      shippedAt: new Date(),
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

/**
 * POST /api/shiprocket/reverse/:orderId/:rmaNumber
 * Schedule reverse pickup
 */
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
      (item) => String(item.rmaNumber) === String(rmaNumber)
    );

    if (!rma) {
      return res.status(404).json({
        success: false,
        message: "RMA not found",
      });
    }

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

    const payload = buildReverseShiprocketPayload({ order, rma });

    console.log("📦 Shiprocket Reverse Payload:", JSON.stringify(payload, null, 2));

    const shipment = await createShipment(payload);

    console.log("✅ Shiprocket Reverse Response:", JSON.stringify(shipment, null, 2));

    const reverseAwb = s(shipment?.awb_code);

    if (!reverseAwb) {
      throw new Error(
        shipment?.message ||
          shipment?.error ||
          "Shiprocket did not return reverse AWB. Reverse booking failed."
      );
    }

    rma.reverseShipment = {
      provider: "shiprocket",
      orderId: String(shipment.order_id || ""),
      shipmentId: String(shipment.shipment_id || ""),
      awb: reverseAwb,
      courierName: s(shipment.courier_name),
      trackingUrl: s(shipment.tracking_url),
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
  } catch (err) {
    console.error("❌ Reverse Pickup Error:", getShiprocketError(err));
    return sendShiprocketError(res, err, "Reverse pickup failed");
  }
}

/**
 * GET /api/shiprocket/token
 * Returns valid Shiprocket auth token
 */
export async function getShiprocketTokenApi(req, res) {
  try {
    const token = await getShiprocketToken();

    if (!token) {
      return res.status(500).json({
        success: false,
        message: "Failed to generate Shiprocket token",
      });
    }

    return res.status(200).json({
      success: true,
      token,
    });
  } catch (err) {
    console.error("❌ Shiprocket Token API Error:", getShiprocketError(err));

    return sendShiprocketError(
      res,
      err,
      "Shiprocket authentication failed"
    );
  }
}

/**
 * POST /api/shiprocket/sync-tracking/:id
 * Sync tracking by local order id or orderNumber query
 */
export async function syncShiprocketTrackingFlex(req, res) {
  try {
    const id = req.params?.id;
    const orderNumber = s(req.query?.orderNumber);

    let order = null;

    if (id) {
      order = await Order.findById(id);
    } else if (orderNumber) {
      order = await Order.findOne({ orderNumber });
    } else {
      return res.status(400).json({
        success: false,
        message: "Provide order id or orderNumber",
      });
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
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
      order?.shipment?.shiprocket?.awb || order?.trackingDetails?.trackingId
    );

    const existingCourier = s(
      order?.shipment?.shiprocket?.courierName ||
        order?.trackingDetails?.courierName
    );

    const existingUrl = s(
      order?.shipment?.shiprocket?.trackingUrl ||
        order?.trackingDetails?.trackingUrl
    );

    const token = await getShiprocketToken();

    if (!token) {
      return res.status(500).json({
        success: false,
        message: "Shiprocket token not available",
      });
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    let nextAwb = existingAwb;
    let nextCourier = existingCourier;
    let nextUrl = existingUrl;

    let source = "";
    let rawTrack = null;
    let rawShow = null;
    let trackFailed = false;
    let trackError = null;

    if (shipmentId) {
      try {
        const trackRes = await axios.get(
          `${SHIPROCKET_BASE}/courier/track/shipment/${encodeURIComponent(
            shipmentId
          )}`,
          { headers, timeout: 20000 }
        );

        rawTrack = trackRes.data || {};

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
        console.error("❌ Shiprocket track/shipment failed:", getShiprocketError(err));
      }
    } else {
      trackFailed = true;
    }

    const needMore = !nextAwb || !nextCourier;

    if ((trackFailed || needMore) && shiprocketOrderId) {
      try {
        const showRes = await axios.get(
          `${SHIPROCKET_BASE}/orders/show/${encodeURIComponent(
            shiprocketOrderId
          )}`,
          { headers, timeout: 20000 }
        );

        rawShow = showRes.data || {};

        const awbFromShow = s(
          rawShow?.awb_code ||
            rawShow?.awb ||
            rawShow?.shipment?.awb_code ||
            rawShow?.shipment?.awb
        );

        const courierFromShow = s(
          rawShow?.courier_name ||
            rawShow?.courier ||
            rawShow?.shipment?.courier_name ||
            rawShow?.shipment?.courier
        );

        const urlFromShow = s(
          rawShow?.tracking_url || rawShow?.shipment?.tracking_url
        );

        if (awbFromShow) nextAwb = awbFromShow;
        if (courierFromShow) nextCourier = courierFromShow;
        if (urlFromShow) nextUrl = urlFromShow;

        source = source ? `${source} + orders/show` : "orders/show";
      } catch (err) {
        console.error("⚠️ Shiprocket orders/show fallback failed:", getShiprocketError(err));

        if (!nextAwb && !nextCourier && !nextUrl && isShiprocketTemporaryError(err)) {
          return sendShiprocketError(
            res,
            err,
            "Shiprocket tracking sync failed"
          );
        }
      }
    }

    const gotAny = Boolean(nextAwb || nextCourier || nextUrl);

    if (!gotAny && trackFailed && trackError && isShiprocketTemporaryError(trackError)) {
      return sendShiprocketError(
        res,
        trackError,
        "Shiprocket tracking sync failed"
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
        rawTrack,
        rawShow,
      });
    }

    const $set = {
      "shipment.provider": "shiprocket",
      "shipment.shiprocket.lastUpdatedAt": new Date(),
    };

    if (nextAwb) {
      $set["shipment.shiprocket.awb"] = nextAwb;
      $set["trackingDetails.trackingId"] = nextAwb;
    }

    if (nextCourier) {
      $set["shipment.shiprocket.courierName"] = nextCourier;
      $set["trackingDetails.courierName"] = nextCourier;
    }

    if (nextUrl) {
      $set["shipment.shiprocket.trackingUrl"] = nextUrl;
      $set["trackingDetails.trackingUrl"] = nextUrl;
    }

    await Order.updateOne({ _id: order._id }, { $set });

    return res.status(200).json({
      success: true,
      message: "Tracking synced from Shiprocket",
      source: source || "shiprocket",
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      shipmentId,
      shiprocketOrderId,
      trackingId: nextAwb,
      courierName: nextCourier,
      trackingUrl: nextUrl,
    });
  } catch (err) {
    console.error("❌ Shiprocket Tracking Sync Error:", getShiprocketError(err));

    return sendShiprocketError(
      res,
      err,
      "Shiprocket tracking sync failed"
    );
  }
}

/**
 * GET /api/shiprocket/serviceability
 * Check courier serviceability between pincodes
 */
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

    return sendShiprocketError(
      res,
      err,
      "Failed to check serviceability"
    );
  }
}