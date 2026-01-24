// Xpressbees/xpressbees.controller.js

import mongoose from "mongoose";
import Order from "../Orders/Orders.js"; // <-- CHANGE PATH as per your project

import {
  createShipmentForOrder,
  syncTrackingForOrder,
  trackByAwb,
  cancelShipment,
//   manifestShipments,
} from "./index.js";

function toBool(v) {
  if (typeof v === "boolean") return v;
  const s = String(v || "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(s);
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function blockIfTerminal(order) {
  const terminalFulfillment = ["delivered", "cancelled", "returned", "rto"];
  const terminalShipment = ["delivered", "cancelled", "rto"];

  if (terminalFulfillment.includes(order.fulfillmentStatus)) {
    return `Order is in terminal fulfillmentStatus: ${order.fulfillmentStatus}`;
  }
  if (order.shipment?.status && terminalShipment.includes(order.shipment.status)) {
    return `Order is in terminal shipment.status: ${order.shipment.status}`;
  }
  return null;
}

function alreadyHasXpressbeesAwb(order) {
  return Boolean(order?.shipment?.xpressbees?.awb || order?.trackingDetails?.trackingId);
}

/**
 * POST /api/shipping/xpressbees/:orderId/create
 * Body (optional):
 *  - force: boolean (allow booking even if not confirmed / other provider etc)
 *  - confirmIfCOD: boolean (auto confirm COD order before booking)
 *  - preferXpressbeesProvider: boolean (set provider to xpressbees)
 */
export async function createXpressbeesShipmentController(req, res) {
  try {
    const orderId = req.params.orderId;
    if (!isValidObjectId(orderId)) {
      return res.status(400).json({ ok: false, message: "Invalid orderId" });
    }

    const force = toBool(req.query.force) || toBool(req.body?.force);
    const confirmIfCOD = toBool(req.body?.confirmIfCOD);
    const preferXpressbeesProvider = req.body?.preferXpressbeesProvider ?? true;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, message: "Order not found" });

    // Block terminal states always (even force) — safety.
    const terminalReason = blockIfTerminal(order);
    if (terminalReason) {
      return res.status(409).json({ ok: false, message: terminalReason });
    }

    // Idempotency: if already booked with XpressBees AWB
    if (alreadyHasXpressbeesAwb(order) && order?.shipment?.provider === "xpressbees") {
      return res.status(200).json({
        ok: true,
        message: "Shipment already booked with XpressBees",
        awb: order?.shipment?.xpressbees?.awb || order?.trackingDetails?.trackingId,
        shipmentId: order?.shipment?.xpressbees?.shipmentId || "",
        labelUrl: order?.shipment?.xpressbees?.labelUrl || "",
      });
    }

    // If provider is something else and not force -> block
    const provider = order?.shipment?.provider || "shiprocket";
    if (provider !== "xpressbees" && !force && provider !== "manual") {
      return res.status(409).json({
        ok: false,
        message: `Order shipment provider is '${provider}'. Use force=1 to book with XpressBees.`,
      });
    }

    // Confirm rules:
    // - If order is not confirmed:
    //   - allow if force=1 AND (either already paid online OR confirmIfCOD is true for COD)
    if (!order.isConfirmed) {
      const isPrepaidPaid =
        order.paymentMethod === "razorpay" && order.paymentStatus === "paid";

      const isCOD = order.paymentMethod === "cod";

      if (!force) {
        return res.status(409).json({
          ok: false,
          message: "Order not confirmed. Confirm first or use force=1 with confirmIfCOD (for COD).",
        });
      }

      // force path
      if (isPrepaidPaid) {
        // ok (already paid online)
        order.isConfirmed = true;
        order.confirmedAt = new Date();
        await order.save();
      } else if (isCOD) {
        if (!confirmIfCOD) {
          return res.status(409).json({
            ok: false,
            message:
              "COD order not confirmed. Send { confirmIfCOD: true } with force=1 to auto-confirm before booking.",
          });
        }
        // Auto confirm COD
        order.isConfirmed = true;
        order.confirmedAt = new Date();
        await order.save();
      } else {
        return res.status(409).json({
          ok: false,
          message: "Order not confirmed and not eligible for auto-confirm.",
        });
      }
    }

    // Optional: set provider to xpressbees before booking (helps service logic & data cleanliness)
    if (preferXpressbeesProvider) {
      order.shipment = order.shipment || {};
      order.shipment.provider = "xpressbees";
      await order.save();
    }

    // Now create shipment using service
    const result = await createShipmentForOrder(orderId);

    return res.status(201).json({
      ok: true,
      message: "XpressBees shipment booked",
      ...result,
    });
  } catch (err) {
    const status = err?.response?.status || 500;
    const upstream = err?.response?.data;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      message: err?.message || "Failed to create shipment",
      upstream,
    });
  }
}

/**
 * POST /api/shipping/xpressbees/:orderId/sync
 */
export async function syncXpressbeesTrackingController(req, res) {
  try {
    const orderId = req.params.orderId;
    if (!isValidObjectId(orderId)) {
      return res.status(400).json({ ok: false, message: "Invalid orderId" });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, message: "Order not found" });

    // Require xpressbees provider unless force
    const force = toBool(req.query.force) || toBool(req.body?.force);
    if (order?.shipment?.provider !== "xpressbees" && !force) {
      return res.status(409).json({
        ok: false,
        message: `Order provider is '${order?.shipment?.provider}'. Use force=1 to sync anyway.`,
      });
    }

    const result = await syncTrackingForOrder(orderId);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const status = err?.response?.status || 500;
    const upstream = err?.response?.data;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      message: err?.message || "Failed to sync tracking",
      upstream,
    });
  }
}

/**
 * GET /api/shipping/xpressbees/track/:awb
 */
export async function trackXpressbeesByAwbController(req, res) {
  try {
    const awb = String(req.params.awb || "").trim();
    if (!awb) return res.status(400).json({ ok: false, message: "AWB required" });

    const result = await trackByAwb(awb);
    return res.status(200).json({ ok: true, awb, ...result });
  } catch (err) {
    const status = err?.response?.status || 500;
    const upstream = err?.response?.data;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      message: err?.message || "Failed to track",
      upstream,
    });
  }
}

/**
 * POST /api/shipping/xpressbees/manifest
 * Body: { awbs: string[] }
 */
export async function manifestXpressbeesController(req, res) {
  try {
    const awbs = Array.isArray(req.body?.awbs) ? req.body.awbs : [];
    if (!awbs.length) return res.status(400).json({ ok: false, message: "awbs[] required" });

    const result = await manifestShipments(awbs);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const status = err?.response?.status || 500;
    const upstream = err?.response?.data;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      message: err?.message || "Failed to create manifest",
      upstream,
    });
  }
}

/**
 * POST /api/shipping/xpressbees/cancel/:awb
 */
export async function cancelXpressbeesController(req, res) {
  try {
    const awb = String(req.params.awb || "").trim();
    if (!awb) return res.status(400).json({ ok: false, message: "AWB required" });

    const result = await cancelShipment(awb);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const status = err?.response?.status || 500;
    const upstream = err?.response?.data;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      message: err?.message || "Failed to cancel shipment",
      upstream,
    });
  }
}
