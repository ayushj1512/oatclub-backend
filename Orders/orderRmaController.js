import mongoose from "mongoose";
import Order from "./Orders.js"; // ✅ same as your current import path

/* ============================================================
   RMA POLICY
============================================================ */
const RMA_POLICY = {
  windowDays: 7,
  exchange: { firstFree: true, secondFee: 199 },
  countExchangeStatuses: [
    "requested",
    "approved",
    "pickup_scheduled",
    "picked",
    "in_transit",
    "received",
    "qc_pass",
    "qc_fail",
    "replacement_shipped",
    "closed",
  ],
};

/* ============================================================
   HELPERS
============================================================ */
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

const daysDiff = (fromDate, toDate) => {
  const a = new Date(fromDate).getTime();
  const b = new Date(toDate).getTime();
  return Math.floor((a - b) / (1000 * 60 * 60 * 24));
};

const isWithinRmaWindow = (deliveredAt) => {
  if (!deliveredAt) return false;
  const diff = daysDiff(Date.now(), deliveredAt);
  return diff >= 0 && diff <= RMA_POLICY.windowDays;
};

// count previous exchanges (excluding rejected)
const countPreviousExchanges = (order) =>
  (order?.rmas || []).filter((r) => {
    if (!r) return false;
    if (r.type !== "exchange") return false;
    if (r.status === "rejected") return false;
    return RMA_POLICY.countExchangeStatuses.includes(r.status);
  }).length;

const computeExchangeFee = (exchangeCountSoFar) => {
  if (RMA_POLICY.exchange.firstFree && exchangeCountSoFar === 0) return 0;
  return Number(RMA_POLICY.exchange.secondFee || 0);
};

// Remaining qty per orderLineId
const computeRemainingQtyByLineId = (order) => {
  const purchased = new Map();
  (order.items || []).forEach((it) =>
    purchased.set(String(it.lineId), Number(it.quantity || 0))
  );

  const used = new Map();
  (order.rmas || []).forEach((r) => {
    if (!r || r.status === "rejected") return;
    (r.items || []).forEach((ri) => {
      const k = String(ri.orderLineId);
      used.set(k, (used.get(k) || 0) + Number(ri.quantity || 0));
    });
  });

  const remaining = new Map();
  for (const [k, bought] of purchased.entries()) {
    remaining.set(k, Math.max(0, bought - (used.get(k) || 0)));
  }
  return remaining;
};

// Build RMA item snapshots (lineId based)
const buildRmaItemsSnapshots = (order, rmaItems) => {
  const out = [];
  const orderItems = order.items || [];

  for (const ri of rmaItems || []) {
    const lineId = String(ri?.orderLineId || "").trim();
    const qty = Number(ri?.quantity);

    if (!lineId) throw new Error("orderLineId missing in RMA items");
    if (!Number.isFinite(qty) || qty < 1)
      throw new Error("Invalid quantity in RMA items");

    const index = orderItems.findIndex((it) => String(it.lineId) === lineId);
    if (index === -1)
      throw new Error(`Order item not found for orderLineId: ${lineId}`);

    const orderItem = orderItems[index];

    out.push({
      orderLineId: lineId,
      orderItemIndex: index, // optional for admin UI
      quantity: qty,
      productId: orderItem.productId || null,
      productCode: orderItem?.productSnapshot?.productCode || "",
      title: orderItem?.productSnapshot?.title || "",
      variantSku: orderItem?.variant?.sku || "",
    });
  }

  return out;
};

/* ============================================================
   ✅ CREATE RMA (Return / Exchange)
   POST /api/orders/:id/rma
============================================================ */
export const createRma = async (req, res) => {
  try {
    const orderId = req.params.id;
    const {
      type = "return",
      reason = "other",
      customerNote = "",
      items,
      exchangeTo,
    } = req.body;

    if (!isObjectId(orderId))
      return res.status(400).json({ message: "Invalid order id" });

    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ message: "RMA items missing" });

    if (!["return", "exchange"].includes(type))
      return res.status(400).json({ message: "Invalid RMA type" });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // ✅ Must be delivered
    if (order.fulfillmentStatus !== "delivered") {
      return res
        .status(400)
        .json({ message: "Return/Exchange allowed only for delivered orders" });
    }

    // ✅ deliveredAt check
    const deliveredAt = order?.trackingDetails?.deliveredAt;
    if (!deliveredAt) {
      return res.status(400).json({
        message: "Delivery date missing (deliveredAt). Cannot create RMA.",
      });
    }

    // ✅ window check
    if (!isWithinRmaWindow(deliveredAt)) {
      return res.status(400).json({
        message: `Return/Exchange window expired. Allowed within ${RMA_POLICY.windowDays} days.`,
      });
    }

    // ✅ Remaining qty check
    const remaining = computeRemainingQtyByLineId(order);
    for (const ri of items) {
      const lineId = String(ri?.orderLineId || "").trim();
      const qty = Number(ri?.quantity || 0);

      const rem = remaining.get(lineId);
      if (!lineId)
        return res.status(400).json({ message: "orderLineId missing" });

      if (rem == null)
        return res.status(400).json({ message: `Invalid orderLineId: ${lineId}` });

      if (!Number.isFinite(qty) || qty < 1)
        return res.status(400).json({ message: "Invalid RMA quantity" });

      if (qty > rem)
        return res.status(400).json({
          message: `Qty exceeds remaining for lineId: ${lineId}`,
        });
    }

    // ✅ Build snapshots
    const rmaItemsSnapshots = buildRmaItemsSnapshots(order, items);

    // ✅ Exchange logic
    let fee = { amount: 0, currency: "INR", status: "waived" };
    let exchangeRequest = null;

    if (type === "exchange") {
      if (!exchangeTo || typeof exchangeTo !== "object" || !exchangeTo.variantId) {
        return res
          .status(400)
          .json({ message: "exchangeTo.variantId missing for exchange" });
      }

      const prevExchanges = countPreviousExchanges(order);
      const amount = computeExchangeFee(prevExchanges);

      fee = { amount, currency: "INR", status: amount > 0 ? "unpaid" : "waived" };

      exchangeRequest = {
        productId: isObjectId(exchangeTo.productId) ? exchangeTo.productId : null,
        variantId: isObjectId(exchangeTo.variantId) ? exchangeTo.variantId : null,
        variantSku: String(exchangeTo.variantSku || ""),
        attributes: Array.isArray(exchangeTo.attributes) ? exchangeTo.attributes : [],
        note: String(exchangeTo.note || ""),
      };
    }

    // ✅ Push RMA
    order.rmas = order.rmas || [];
    order.rmas.push({
      type,
      reason,
      customerNote,
      items: rmaItemsSnapshots,
      status: "requested",
      resolution: "pending",
      fee,
      exchangeRequest,
    });

    // ✅ IMPORTANT FIX: update order fulfillment status
    if (type === "return") order.fulfillmentStatus = "return_requested";
    if (type === "exchange") order.fulfillmentStatus = "exchange_requested";

    await order.save();

    const created = order.rmas[order.rmas.length - 1];

    return res.status(201).json({
      message: "RMA created",
      rma: created,
      orderId: order._id,
      order,
      policy: RMA_POLICY,
    });
  } catch (err) {
    console.error("❌ Create RMA Error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};


/* ============================================================
   ✅ UPDATE RMA (Admin)
   PATCH /api/orders/:id/rma/:rmaNumber
============================================================ */
export const updateRma = async (req, res) => {
  try {
    const orderId = req.params.id;
    const rmaNumber = String(req.params.rmaNumber || "").trim();

    if (!isObjectId(orderId))
      return res.status(400).json({ message: "Invalid order id" });

    if (!rmaNumber)
      return res.status(400).json({ message: "rmaNumber missing" });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const idx = (order.rmas || []).findIndex((r) => String(r.rmaNumber) === rmaNumber);
    if (idx === -1) return res.status(404).json({ message: "RMA not found" });

    const rma = order.rmas[idx];
    const { status, adminNote, resolution, refund, reverseShipment, fee } = req.body;

    // Fee update
    if (fee && typeof fee === "object") {
      rma.fee = rma.fee || { amount: 0, currency: "INR", status: "waived" };
      if (fee.amount != null) rma.fee.amount = Number(fee.amount || 0);
      if (fee.currency != null) rma.fee.currency = String(fee.currency || "INR");
      if (fee.status != null) rma.fee.status = String(fee.status || "waived");
    }

    // Fee gating
    if (rma.type === "exchange" && rma.fee?.amount > 0 && rma.fee.status !== "paid") {
      const blocked = [
        "approved",
        "pickup_scheduled",
        "picked",
        "in_transit",
        "received",
        "replacement_shipped",
        "closed",
      ];
      if (status && blocked.includes(status)) {
        return res
          .status(400)
          .json({ message: "Exchange fee unpaid. Cannot proceed until paid." });
      }
    }

    // Main updates
    if (status) rma.status = status;
    if (adminNote != null) rma.adminNote = String(adminNote);
    if (resolution) rma.resolution = resolution;

    // Refund object
    if (refund && typeof refund === "object") {
      rma.refund = rma.refund || {};
      if (refund.amount != null) rma.refund.amount = Number(refund.amount || 0);
      if (refund.mode) rma.refund.mode = refund.mode;
      if (refund.status) rma.refund.status = refund.status;
      if (refund.referenceId != null)
        rma.refund.referenceId = String(refund.referenceId || "");
    }

    // Reverse pickup object
    if (reverseShipment && typeof reverseShipment === "object") {
      rma.reverseShipment = rma.reverseShipment || {};
      ["orderId", "shipmentId", "awb", "courierName", "trackingUrl"].forEach((f) => {
        if (reverseShipment[f] != null)
          rma.reverseShipment[f] = String(reverseShipment[f] || "");
      });
      ["pickupScheduledAt", "pickedAt", "receivedAt"].forEach((df) => {
        if (reverseShipment[df] != null) rma.reverseShipment[df] = reverseShipment[df];
      });
    }

    await order.save();

    return res.status(200).json({
      message: "RMA updated",
      rma: order.rmas[idx],
      order, // ✅ helpful for frontend refresh
    });
  } catch (err) {
    console.error("❌ Update RMA Error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/* ============================================================
   ✅ GET RMAs by Order
   GET /api/orders/:id/rma
============================================================ */
export const getRmasByOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    return res.status(200).json({ rmas: order.rmas || [] });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/* ============================================================
   ✅ GET single RMA
   GET /api/orders/:id/rma/:rmaNumber
============================================================ */
export const getRmaByNumber = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const rma = (order.rmas || []).find(
      (r) => String(r.rmaNumber) === String(req.params.rmaNumber)
    );

    if (!rma) return res.status(404).json({ message: "RMA not found" });

    return res.status(200).json({ rma });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

export const getAllRmasAdmin = async (req, res) => {
  try {
    const { status, type, search } = req.query;

    const match = { rmas: { $exists: true, $ne: [] } };

    // filter by status / type (optional)
    if (status) match["rmas.status"] = status;
    if (type) match["rmas.type"] = type;

    const orders = await Order.find(match)
      .populate("customerId", "name email phone")
      .sort({ createdAt: -1 })
      .lean();

    const allRmas = [];

    for (const order of orders) {
      for (const rma of order.rmas || []) {
        // optional search by orderNumber or rmaNumber
        if (search) {
          const q = String(search).toLowerCase();
          const ok =
            String(order.orderNumber || "").toLowerCase().includes(q) ||
            String(rma.rmaNumber || "").toLowerCase().includes(q);

          if (!ok) continue;
        }

        allRmas.push({
          ...rma,
          orderId: order._id,
          orderNumber: order.orderNumber,
          customer: order.customerId,
          fulfillmentStatus: order.fulfillmentStatus,
        });
      }
    }

    return res.status(200).json({ rmas: allRmas });
  } catch (err) {
    console.error("❌ Fetch All RMAs Error:", err);
    return res.status(500).json({
      message: err.message || "Server error",
    });
  }
};