import Order from "../Orders/Orders.js";
import { checkServiceability, createShipment } from "./index.js";
import { buildShiprocketPayload } from "./shiprocket.payload.js";
import { buildReverseShiprocketPayload } from "./shiprocket.reverse.payload.js";
import { getShiprocketToken } from "./shiprocket.auth.js";
import axios from "axios";

const SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external";
const isNonEmpty = (v) => String(v || "").trim().length > 0;


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
    console.error("❌ Shiprocket Token API Error:", err?.message || err);

    return res.status(500).json({
      success: false,
      message: "Shiprocket authentication failed",
      error: err?.message,
    });
  }
}


// ✅ Shiprocket Tracking Sync (SHIPMENT ID ONLY)
// Uses: GET /courier/track/shipment/{shipment_id}
// - Only relies on shipmentId stored in order.shipment.shiprocket.shipmentId
// - Updates AWB, courierName, trackingUrl safely (won't overwrite with blanks)

// ✅ UPDATED: Shiprocket Tracking Sync (shipmentId PRIMARY, orderId SHOW fallback)
// Goal: always try to fetch AWB + courierName for portal
// 1) PRIMARY: GET /courier/track/shipment/{shipment_id}
// 2) FALLBACK (when upstream down / fails): GET /orders/show/{order_id} (if saved)
// 3) Safe DB update: never overwrite with blanks
// 4) Better error codes: "SHIPROCKET_UPSTREAM_DOWN" for temporary outages

export async function syncShiprocketTrackingFlex(req, res) {
  try {
    const id = req.params?.id;
    const orderNumber = String(req.query?.orderNumber || "").trim();

    const s = (v) => (v == null ? "" : String(v)).trim();
    const isNonEmpty = (v) => s(v).length > 0;
    const lower = (v) => s(v).toLowerCase();

    // 1) Find order by id OR orderNumber
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
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // 2) IDs (shipmentId primary; orderId fallback for orders/show)
    const shipmentId = s(order?.shipment?.shiprocket?.shipmentId);
    const shiprocketOrderId = s(order?.shipment?.shiprocket?.orderId);

    if (!isNonEmpty(shipmentId) && !isNonEmpty(shiprocketOrderId)) {
      return res.status(400).json({
        success: false,
        message: "Shiprocket shipmentId/orderId missing in order. Cannot sync tracking.",
        orderId: String(order._id),
        orderNumber: order.orderNumber,
      });
    }

    // 3) existing values (fallback)
    const existingAwb = s(order?.shipment?.shiprocket?.awb || order?.trackingDetails?.trackingId);
    const existingCourier = s(
      order?.shipment?.shiprocket?.courierName || order?.trackingDetails?.courierName
    );
    const existingUrl = s(
      order?.shipment?.shiprocket?.trackingUrl || order?.trackingDetails?.trackingUrl
    );

    // 4) token
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

    const markUpstream = (msg) => {
      const m = lower(msg);
      return (
        m.includes("no healthy upstream") ||
        m.includes("bad gateway") ||
        m.includes("upstream") ||
        m.includes("gateway") ||
        m.includes("timeout") ||
        m.includes("etimedout") ||
        m.includes("econnreset")
      );
    };

    /* =========================================================
       A) PRIMARY: Track by SHIPMENT ID
       GET /courier/track/shipment/{shipment_id}
    ========================================================= */
    let trackFailed = false;
    let trackWasUpstream = false;
    let trackErrPayload = null;

    if (isNonEmpty(shipmentId)) {
      try {
        const trackRes = await axios.get(
          `${SHIPROCKET_BASE}/courier/track/shipment/${encodeURIComponent(shipmentId)}`,
          { headers, timeout: 20000 }
        );

        rawTrack = trackRes.data || {};
        const td = rawTrack?.tracking_data || {};
        const st = (td?.shipment_track && td.shipment_track[0]) || {};

        const awbFromTrack = s(st?.awb_code || td?.awb_code);
        const courierFromTrack = s(st?.courier_name);
        const urlFromTrack = s(st?.tracking_url);

        if (isNonEmpty(awbFromTrack)) nextAwb = awbFromTrack;
        if (isNonEmpty(courierFromTrack)) nextCourier = courierFromTrack;
        if (isNonEmpty(urlFromTrack)) nextUrl = urlFromTrack;

        source = "courier/track/shipment";
      } catch (e) {
        trackFailed = true;
        trackErrPayload = e?.response?.data || null;
        const msg = trackErrPayload?.message || e.message || "";
        trackWasUpstream = markUpstream(msg);

        console.error("❌ Shiprocket track/shipment failed:", trackErrPayload || e.message);
      }
    } else {
      trackFailed = true; // no shipmentId, force fallback if possible
    }

    /* =========================================================
       B) FALLBACK: Orders Show by ORDER ID (if tracking failed OR missing key data)
       GET /orders/show/{order_id}
       Works even when tracking upstream is flaky sometimes.
    ========================================================= */
    const needMore = !isNonEmpty(nextAwb) || !isNonEmpty(nextCourier);

    if ((trackFailed || needMore) && isNonEmpty(shiprocketOrderId)) {
      try {
        const showRes = await axios.get(
          `${SHIPROCKET_BASE}/orders/show/${encodeURIComponent(shiprocketOrderId)}`,
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

        const urlFromShow = s(rawShow?.tracking_url || rawShow?.shipment?.tracking_url);

        if (isNonEmpty(awbFromShow)) nextAwb = awbFromShow;
        if (isNonEmpty(courierFromShow)) nextCourier = courierFromShow;
        if (isNonEmpty(urlFromShow)) nextUrl = urlFromShow;

        source = source ? `${source} + orders/show` : "orders/show";
      } catch (e) {
        const srErr = e?.response?.data || null;
        console.error("⚠️ Shiprocket orders/show fallback failed:", srErr || e.message);
      }
    }

    /* =========================================================
       C) If still no meaningful data
    ========================================================= */
    const gotAny = isNonEmpty(nextAwb) || isNonEmpty(nextCourier) || isNonEmpty(nextUrl);

    // If primary failed due to upstream and we couldn't recover via show -> return 503 (retry)
    if (!gotAny && trackFailed && trackWasUpstream) {
      return res.status(503).json({
        success: false,
        code: "SHIPROCKET_UPSTREAM_DOWN",
        message: "Shiprocket service temporary issue. Please retry in a few minutes.",
        retryAfterSec: 120,
        shipmentId: shipmentId || "",
        shiprocketOrderId: shiprocketOrderId || "",
        error: trackErrPayload || "no healthy upstream",
      });
    }

    // Otherwise: no AWB yet (courier not assigned)
    if (!gotAny) {
      return res.status(200).json({
        success: true,
        message: "Tracking not available yet (AWB/Carrier not generated or courier not assigned).",
        source: source || (trackFailed ? "none" : "courier/track/shipment"),
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        shipmentId: shipmentId || "",
        shiprocketOrderId: shiprocketOrderId || "",
        trackingId: existingAwb || "",
        courierName: existingCourier || "",
        trackingUrl: existingUrl || "",
        // helpful debug (optional)
        rawTrack,
        rawShow,
      });
    }

    /* =========================================================
       D) Safe DB update (only non-empty)
    ========================================================= */
    const $set = {
      "shipment.provider": "shiprocket",
      "shipment.shiprocket.lastUpdatedAt": new Date(),
    };

    if (isNonEmpty(nextAwb)) {
      $set["shipment.shiprocket.awb"] = nextAwb;
      $set["trackingDetails.trackingId"] = nextAwb;
    }
    if (isNonEmpty(nextCourier)) {
      $set["shipment.shiprocket.courierName"] = nextCourier;
      $set["trackingDetails.courierName"] = nextCourier;
    }
    if (isNonEmpty(nextUrl)) {
      $set["shipment.shiprocket.trackingUrl"] = nextUrl;
      $set["trackingDetails.trackingUrl"] = nextUrl;
    }

    await Order.updateOne({ _id: order._id }, { $set });

    /* =========================================================
       E) Respond
    ========================================================= */
    return res.status(200).json({
      success: true,
      message: "Tracking synced from Shiprocket",
      source: source || "shiprocket",
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      shipmentId: shipmentId || "",
      shiprocketOrderId: shiprocketOrderId || "",
      trackingId: nextAwb || "",
      courierName: nextCourier || "",
      trackingUrl: nextUrl || "",
    });
  } catch (err) {
    const shiprocketError = err?.response?.data || null;
    console.error("❌ Shiprocket Tracking Sync Error:", shiprocketError || err.message);

    return res.status(500).json({
      success: false,
      message: "Shiprocket tracking sync failed",
      error: shiprocketError || err.message,
    });
  }
}